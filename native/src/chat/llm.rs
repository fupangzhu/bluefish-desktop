//! llm.mjs: a minimal OpenAI-compatible chat client (DeepSeek, Qwen, Ollama ...), plus the HTTP
//! agent shared with the WeChat client (proxy from the settings, else the system proxy).
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Config,
    Auth,
    Http,
    Network,
}
#[derive(Clone, Debug)]
pub struct LlmError {
    pub message: String,
    pub kind: Kind,
}
impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
fn fail(message: impl Into<String>, kind: Kind) -> LlmError {
    LlmError { message: message.into(), kind }
}

#[derive(Clone, Debug)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub args: Value,
    pub raw: Value,
}
#[derive(Clone, Debug, Default)]
pub struct Reply {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub total_tokens: u64,
}

pub fn parse_args(raw: &Value) -> Value {
    match raw {
        Value::Object(_) => raw.clone(),
        Value::String(s) => serde_json::from_str::<Value>(s).ok().filter(|v| v.is_object()).unwrap_or_else(|| json!({})),
        _ => json!({}),
    }
}
pub fn read_choice(j: &Value) -> Reply {
    let msg = &j["choices"][0]["message"];
    let tool_calls = msg["tool_calls"]
        .as_array()
        .map(|a| {
            a.iter()
                .enumerate()
                .map(|(i, c)| ToolCall {
                    id: c["id"].as_str().map(String::from).unwrap_or_else(|| format!("call_{i}")),
                    name: c["function"]["name"].as_str().unwrap_or("").to_string(),
                    args: parse_args(&c["function"]["arguments"]),
                    raw: c.clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    Reply { content: msg["content"].as_str().unwrap_or("").to_string(), tool_calls, total_tokens: j["usage"]["total_tokens"].as_u64().unwrap_or(0) }
}

/// "127.0.0.1:7897" is accepted too; an empty value means no configured proxy.
pub fn normalize_proxy(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Ok(String::new());
    }
    let with = if text.contains("://") { text.to_string() } else { format!("http://{text}") };
    let scheme = with.split("://").next().unwrap_or("").to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err("代理只支持 http:// 或 https://".into());
    }
    let rest = &with[with.find("://").unwrap() + 3..];
    let host = rest.rsplit('@').next().unwrap_or("").split(['/', ':']).next().unwrap_or("");
    if host.is_empty() {
        return Err("代理地址缺少主机名".into());
    }
    Ok(text.to_string())
}

/// The system (WinINet) proxy, the one Chromium's fetch used in the Electron build.
fn system_proxy() -> Option<String> {
    #[cfg(windows)]
    unsafe {
        use windows::core::w;
        use windows::Win32::System::Registry::*;
        let mut key = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, w!("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"), 0, KEY_READ, &mut key).is_err() {
            return None;
        }
        let read_dword = |name: windows::core::PCWSTR| {
            let mut v = 0u32;
            let mut size = 4u32;
            RegQueryValueExW(key, name, None, None, Some(&mut v as *mut u32 as *mut u8), Some(&mut size)).ok().map(|_| v)
        };
        let enabled = read_dword(w!("ProxyEnable")).unwrap_or(0) != 0;
        let mut buf = [0u16; 512];
        let mut size = (buf.len() * 2) as u32;
        let server = RegQueryValueExW(key, w!("ProxyServer"), None, None, Some(buf.as_mut_ptr() as *mut u8), Some(&mut size))
            .ok()
            .map(|_| String::from_utf16_lossy(&buf[..(size as usize / 2).saturating_sub(1)]))
            .ok();
        let _ = RegCloseKey(key);
        if !enabled {
            return None;
        }
        let server = server?;
        // "host:port" or "http=host:port;https=host:port".
        let pick = server.split(';').find(|p| p.starts_with("https=")).or_else(|| server.split(';').find(|p| p.starts_with("http="))).unwrap_or(&server);
        let hostport = pick.split('=').next_back().unwrap_or("").trim();
        if hostport.is_empty() {
            None
        } else {
            Some(format!("http://{hostport}"))
        }
    }
    #[cfg(not(windows))]
    None
}

/// An HTTP agent for this proxy setting.
pub fn agent(proxy: &str, timeout: Duration) -> ureq::Agent {
    let mut b = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout(timeout);
    if let Ok(tls) = native_tls::TlsConnector::new() {
        b = b.tls_connector(std::sync::Arc::new(tls));
    }
    let p = if proxy.trim().is_empty() { system_proxy() } else { Some(if proxy.contains("://") { proxy.trim().to_string() } else { format!("http://{}", proxy.trim()) }) };
    if let Some(p) = p.and_then(|p| ureq::Proxy::new(p).ok()) {
        b = b.proxy(p);
    }
    b.build()
}

fn trim_base(u: &str) -> String {
    u.trim().trim_end_matches('/').to_string()
}

pub struct Request<'a> {
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub model: &'a str,
    pub proxy: &'a str,
    pub messages: &'a Value,
    pub tools: Option<&'a Value>,
    pub temperature: f64,
    pub max_tokens: u32,
    pub thinking: Option<Value>,
}
pub fn chat(r: &Request) -> Result<Reply, LlmError> {
    if trim_base(r.base_url).is_empty() {
        return Err(fail("还没有填模型接口地址", Kind::Config));
    }
    if r.api_key.is_empty() {
        return Err(fail("还没有填 API Key", Kind::Config));
    }
    if r.model.is_empty() {
        return Err(fail("还没有选模型", Kind::Config));
    }
    let mut body = json!({"model": r.model, "messages": r.messages, "temperature": r.temperature, "max_tokens": r.max_tokens});
    if let Some(t) = r.tools.filter(|t| t.as_array().is_some_and(|a| !a.is_empty())) {
        body["tools"] = t.clone();
        body["tool_choice"] = json!("auto");
    }
    if let Some(t) = &r.thinking {
        body["thinking"] = t.clone();
    }
    let url = trim_base(r.base_url) + "/chat/completions";
    let res = agent(r.proxy, Duration::from_secs(60))
        .post(&url)
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {}", r.api_key))
        .send_string(&body.to_string());
    let (status, text) = match res {
        Ok(resp) => (resp.status(), resp.into_string().unwrap_or_default()),
        Err(ureq::Error::Status(code, resp)) => (code, resp.into_string().unwrap_or_default()),
        Err(e) => {
            let msg = e.to_string();
            let timed = msg.contains("timed out") || msg.contains("Timeout");
            return Err(fail(if timed { "模型接口超时".to_string() } else { format!("连不上模型接口：{msg}") }, Kind::Network));
        }
    };
    if !(200..300).contains(&status) {
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|j| j["error"]["message"].as_str().map(String::from))
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(fail(format!("模型接口返回 {status}：{detail}"), if status == 401 || status == 403 { Kind::Auth } else { Kind::Http }));
    }
    serde_json::from_str::<Value>(&text).map(|j| read_choice(&j)).map_err(|_| fail("模型接口返回的不是 JSON", Kind::Http))
}

pub fn list_models(base_url: &str, api_key: &str, proxy: &str) -> Result<Vec<String>, LlmError> {
    if trim_base(base_url).is_empty() || api_key.is_empty() {
        return Err(fail("先填接口地址和 API Key", Kind::Config));
    }
    let res = agent(proxy, Duration::from_secs(15)).get(&(trim_base(base_url) + "/models")).set("Authorization", &format!("Bearer {api_key}")).call();
    let text = match res {
        Ok(r) => r.into_string().unwrap_or_default(),
        Err(ureq::Error::Status(code, _)) => return Err(fail(format!("获取模型列表失败：{code}"), if code == 401 { Kind::Auth } else { Kind::Http })),
        Err(e) => return Err(fail(format!("连不上模型接口：{e}"), Kind::Network)),
    };
    let j: Value = serde_json::from_str(&text).map_err(|_| fail("模型接口返回的不是 JSON", Kind::Http))?;
    let mut ids: Vec<String> = j["data"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect()).unwrap_or_default();
    ids.sort();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tool_call_arguments_are_parsed_defensively() {
        assert_eq!(parse_args(&json!("{\"a\":1}")), json!({"a": 1}));
        assert_eq!(parse_args(&json!("not json")), json!({}));
        let r = read_choice(&json!({"choices":[{"message":{"content":null,"tool_calls":[{"id":"x","function":{"name":"act","arguments":"{\"action\":\"nod\"}"}}]}}]}));
        assert_eq!(r.content, "");
        assert_eq!(r.tool_calls[0].name, "act");
        assert_eq!(r.tool_calls[0].args["action"], "nod");
    }
    #[test]
    fn proxies() {
        assert_eq!(normalize_proxy("127.0.0.1:7897").unwrap(), "127.0.0.1:7897");
        assert!(normalize_proxy("socks5://x:1").is_err());
        assert_eq!(normalize_proxy("  ").unwrap(), "");
    }
}
