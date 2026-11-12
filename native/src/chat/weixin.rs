//! weixin.mjs: WeChat over Tencent's official ClawBot iLink Bot API. The owner scans a QR with their
//! own WeChat; only that person's messages reach the brain. Login and long polling run on their
//! own threads; events go back to the owner of the client over a channel.
use super::config::write_json;
use super::events::rand_u32;
use super::secret;
use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const BASE: &str = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION: &str = "1.0.0";
const QR_POLL: Duration = Duration::from_millis(2000);
const POLL_TIMEOUT: Duration = Duration::from_secs(40);
const SEND_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_TEXT: usize = 2000;
const USER: i64 = 1;
const BOT: i64 = 2;
const FINISH: i64 = 2;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Status {
    /// off, qr, scanned, connected, retrying, expired, error
    pub state: String,
    pub url: Option<String>,
    pub message: Option<String>,
    pub can_send: bool,
}
pub enum WxEvent {
    Message(String),
    Status(Status),
}

#[derive(Clone, Debug, Default)]
struct State {
    token: String,
    base_url: String,
    bot_id: String,
    user_id: String,
    cursor: String,
    context: String,
    context_at: f64,
}
struct Inner {
    state: Option<State>,
    status: Status,
    ticket: Option<String>,
    login_gen: u64,
    polling: bool,
    stop: bool,
}
#[derive(Clone)]
pub struct Weixin {
    inner: Arc<Mutex<Inner>>,
    file: PathBuf,
    login_base: String,
    proxy: Arc<Mutex<String>>,
    tx: Sender<WxEvent>,
}
#[derive(Debug)]
pub struct WxError {
    pub message: String,
    pub code: Option<i64>,
}
impl std::fmt::Display for WxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
fn err(message: impl Into<String>) -> WxError {
    WxError { message: message.into(), code: None }
}

/// Text the brain should see for one inbound message.
pub fn message_text(items: &Value) -> String {
    let Some(items) = items.as_array() else { return String::new() };
    items
        .iter()
        .map(|it| match it["type"].as_i64() {
            Some(1) => it["text_item"]["text"].as_str().unwrap_or("").to_string(),
            Some(3) => match it["voice_item"]["text"].as_str() {
                Some(t) if !t.is_empty() => format!("（语音）{t}"),
                _ => "（发来一段语音）".into(),
            },
            Some(2) => "（发来一张图片）".into(),
            Some(4) => match it["file_item"]["file_name"].as_str() {
                Some(n) if !n.is_empty() => format!("（发来一个文件：{n}）"),
                _ => "（发来一个文件）".into(),
            },
            Some(5) => "（发来一段视频）".into(),
            _ => String::new(),
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}
fn uin() -> String {
    base64::engine::general_purpose::STANDARD.encode(rand_u32().to_string())
}
fn uuid() -> String {
    format!("{:08x}-{:04x}-4{:03x}-a{:03x}-{:08x}{:04x}", rand_u32(), rand_u32() & 0xffff, rand_u32() & 0xfff, rand_u32() & 0xfff, rand_u32(), rand_u32() & 0xffff)
}

impl Weixin {
    pub fn new(dir: PathBuf, login_base: Option<String>, proxy: Arc<Mutex<String>>, tx: Sender<WxEvent>) -> Weixin {
        let file = dir.join("weixin.json");
        let state = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| {
            let token = secret::unprotect(v["tokenDpapi"].as_str()?)?;
            let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
            Some(State {
                token,
                base_url: s("baseUrl"),
                bot_id: s("botId"),
                user_id: s("userId"),
                cursor: s("cursor"),
                context: s("context"),
                context_at: v["contextAt"].as_f64().unwrap_or(0.0),
            })
        });
        let status = Status { state: if state.is_some() { "connected" } else { "off" }.into(), can_send: state.as_ref().is_some_and(|s| !s.context.is_empty()), ..Status::default() };
        Weixin {
            inner: Arc::new(Mutex::new(Inner { state, status, ticket: None, login_gen: 0, polling: false, stop: false })),
            file,
            login_base: login_base.unwrap_or_else(|| BASE.into()).trim_end_matches('/').to_string(),
            proxy,
            tx,
        }
    }
    pub fn status(&self) -> Status {
        let i = self.inner.lock().unwrap();
        Status { can_send: i.state.as_ref().is_some_and(|s| !s.context.is_empty()), ..i.status.clone() }
    }
    fn set_status(&self, s: Status) {
        let s = {
            let mut i = self.inner.lock().unwrap();
            i.status = s;
            Status { can_send: i.state.as_ref().is_some_and(|x| !x.context.is_empty()), ..i.status.clone() }
        };
        let _ = self.tx.send(WxEvent::Status(s));
    }
    fn persist(&self) {
        let i = self.inner.lock().unwrap();
        match &i.state {
            None => {
                let _ = std::fs::remove_file(&self.file);
            }
            Some(s) => {
                let Some(tok) = secret::protect(&s.token) else { return };
                let _ = write_json(
                    &self.file,
                    &json!({"tokenDpapi": tok, "baseUrl": s.base_url, "botId": s.bot_id, "userId": s.user_id, "cursor": s.cursor, "context": s.context, "contextAt": s.context_at}),
                );
            }
        }
    }

    fn request(&self, path: &str, body: Option<&Value>, token: Option<&str>, base: Option<&str>, timeout: Duration, headers: &[(&str, &str)]) -> Result<Value, WxError> {
        let base = base.map(String::from).unwrap_or_else(|| {
            let i = self.inner.lock().unwrap();
            i.state.as_ref().map(|s| s.base_url.clone()).filter(|b| !b.is_empty()).unwrap_or_else(|| self.login_base.clone())
        });
        let url = format!("{}{}", base.trim_end_matches('/'), path);
        let agent = super::llm::agent(&self.proxy.lock().unwrap(), timeout);
        let res = match body {
            Some(b) => {
                let mut r = agent.post(&url).set("Content-Type", "application/json").set("AuthorizationType", "ilink_bot_token").set("X-WECHAT-UIN", &uin());
                if let Some(t) = token {
                    r = r.set("Authorization", &format!("Bearer {t}"));
                }
                for (k, v) in headers {
                    r = r.set(k, v);
                }
                r.send_string(&b.to_string())
            }
            None => {
                let mut r = agent.get(&url);
                for (k, v) in headers {
                    r = r.set(k, v);
                }
                r.call()
            }
        };
        let (status, text) = match res {
            Ok(r) => (r.status(), r.into_string().unwrap_or_default()),
            Err(ureq::Error::Status(c, r)) => (c, r.into_string().unwrap_or_default()),
            Err(e) => return Err(err(e.to_string())),
        };
        let j: Value = if text.is_empty() { json!({}) } else { serde_json::from_str(&text).map_err(|_| err(format!("微信接口返回的不是 JSON（{status}）")))? };
        let msg = |fallback: String| j["errmsg"].as_str().map(String::from).unwrap_or(fallback);
        if !(200..300).contains(&status) {
            return Err(WxError { message: msg(format!("微信接口 HTTP {status}")), code: j["errcode"].as_i64() });
        }
        if let Some(r) = j["ret"].as_i64().filter(|r| *r != 0) {
            return Err(WxError { message: msg(format!("微信接口失败（{r}）")), code: Some(j["errcode"].as_i64().unwrap_or(r)) });
        }
        if let Some(c) = j["errcode"].as_i64().filter(|c| *c != 0) {
            return Err(WxError { message: msg(format!("微信接口失败（{c}）")), code: Some(c) });
        }
        Ok(j)
    }

    // ---- login ----
    /// Shows a QR (status "qr" with its url), follows it to confirmation, then starts receiving.
    pub fn login(&self) {
        let gen = {
            let mut i = self.inner.lock().unwrap();
            i.login_gen += 1;
            i.login_gen
        };
        let me = self.clone();
        std::thread::spawn(move || {
            let live = || me.inner.lock().unwrap().login_gen == gen;
            let r = (|| -> Result<(), WxError> {
                while live() {
                    let qr = me.request("/ilink/bot/get_bot_qrcode?bot_type=3", None, None, Some(&me.login_base), SEND_TIMEOUT, &[])?;
                    let (Some(code), Some(url)) = (qr["qrcode"].as_str(), qr["qrcode_img_content"].as_str()) else { return Err(err("没拿到登录二维码")) };
                    if !live() {
                        return Ok(());
                    }
                    me.set_status(Status { state: "qr".into(), url: Some(url.into()), ..Status::default() });
                    let mut last = "wait".to_string();
                    while live() {
                        let path = format!("/ilink/bot/get_qrcode_status?qrcode={}", encode(code));
                        let s = me.request(&path, None, None, Some(&me.login_base), POLL_TIMEOUT, &[("iLink-App-ClientVersion", "1")])?;
                        if !live() {
                            return Ok(());
                        }
                        let st = s["status"].as_str().unwrap_or("");
                        if st == "scaned" && last != "scaned" {
                            last = "scaned".into();
                            me.set_status(Status { state: "scanned".into(), url: Some(url.into()), ..Status::default() });
                        }
                        if st == "confirmed" {
                            let (Some(tok), Some(user)) = (s["bot_token"].as_str(), s["ilink_user_id"].as_str()) else {
                                return Err(err("扫码确认了，但没有拿到机器人凭证"));
                            };
                            {
                                let mut i = me.inner.lock().unwrap();
                                i.state = Some(State {
                                    token: tok.into(),
                                    base_url: s["baseurl"].as_str().unwrap_or(&me.login_base).trim_end_matches('/').to_string(),
                                    bot_id: s["ilink_bot_id"].as_str().unwrap_or("").into(),
                                    user_id: user.into(),
                                    ..State::default()
                                });
                                i.ticket = None;
                            }
                            me.persist();
                            me.set_status(Status { state: "connected".into(), ..Status::default() });
                            me.start();
                            return Ok(());
                        }
                        if st == "expired" {
                            break;
                        }
                        std::thread::sleep(QR_POLL);
                    }
                }
                Ok(())
            })();
            if let Err(e) = r {
                if live() {
                    me.set_status(Status { state: "error".into(), message: Some(e.message), ..Status::default() });
                }
            }
        });
    }
    pub fn cancel_login(&self) {
        let (was, connected) = {
            let mut i = self.inner.lock().unwrap();
            i.login_gen += 1;
            (i.status.state.clone(), i.state.is_some())
        };
        if was == "qr" || was == "scanned" {
            self.set_status(Status { state: if connected { "connected" } else { "off" }.into(), ..Status::default() });
        }
    }
    pub fn logout(&self) {
        self.cancel_login();
        {
            let mut i = self.inner.lock().unwrap();
            i.stop = true;
            i.state = None;
            i.ticket = None;
        }
        self.persist();
        self.set_status(Status { state: "off".into(), ..Status::default() });
    }

    // ---- receiving ----
    pub fn start(&self) {
        {
            let mut i = self.inner.lock().unwrap();
            if i.state.is_none() || i.polling {
                return;
            }
            i.polling = true;
            i.stop = false;
        }
        let me = self.clone();
        std::thread::spawn(move || {
            let mut wait = 1000u64;
            loop {
                let (token, cursor) = {
                    let i = me.inner.lock().unwrap();
                    match (&i.state, i.stop) {
                        (Some(s), false) => (s.token.clone(), s.cursor.clone()),
                        _ => break,
                    }
                };
                let body = json!({"get_updates_buf": cursor, "base_info": {"channel_version": CHANNEL_VERSION}});
                match me.request("/ilink/bot/getupdates", Some(&body), Some(&token), None, POLL_TIMEOUT + Duration::from_secs(5), &[]) {
                    Ok(r) => {
                        wait = 1000;
                        if me.inner.lock().unwrap().status.state != "connected" {
                            me.set_status(Status { state: "connected".into(), ..Status::default() });
                        }
                        for m in r["msgs"].as_array().into_iter().flatten() {
                            me.handle(m);
                        }
                        if let Some(c) = r["get_updates_buf"].as_str().filter(|c| !c.is_empty()) {
                            let changed = {
                                let mut i = me.inner.lock().unwrap();
                                match i.state.as_mut() {
                                    Some(s) if s.cursor != c => {
                                        s.cursor = c.into();
                                        true
                                    }
                                    _ => false,
                                }
                            };
                            if changed {
                                me.persist();
                            }
                        }
                    }
                    Err(e) => {
                        if me.inner.lock().unwrap().stop {
                            break;
                        }
                        if e.code == Some(-14) {
                            me.inner.lock().unwrap().state = None;
                            me.persist();
                            me.set_status(Status { state: "expired".into(), ..Status::default() });
                            break;
                        }
                        if e.message.contains("timed out") {
                            continue;
                        }
                        me.set_status(Status { state: "retrying".into(), message: Some(e.message), ..Status::default() });
                        std::thread::sleep(Duration::from_millis(wait));
                        wait = (wait * 2).min(30000);
                    }
                }
            }
            me.inner.lock().unwrap().polling = false;
        });
    }
    pub fn stop(&self) {
        self.inner.lock().unwrap().stop = true;
    }
    fn handle(&self, m: &Value) {
        if m["message_type"].as_i64() != Some(USER) {
            return;
        }
        let changed = {
            let mut i = self.inner.lock().unwrap();
            let Some(s) = i.state.as_mut() else { return };
            // Only the person who scanned the code is the owner.
            if m["from_user_id"].as_str() != Some(s.user_id.as_str()) {
                return;
            }
            match m["context_token"].as_str() {
                Some(c) if !c.is_empty() && c != s.context => {
                    s.context = c.into();
                    s.context_at = super::text::now_ms();
                    i.ticket = None;
                    true
                }
                _ => false,
            }
        };
        if changed {
            self.persist();
        }
        let text = message_text(&m["item_list"]);
        if !text.is_empty() {
            let _ = self.tx.send(WxEvent::Message(text));
        }
    }

    // ---- sending ----
    fn session(&self) -> Option<State> {
        self.inner.lock().unwrap().state.clone().filter(|s| !s.context.is_empty())
    }
    pub fn can_send(&self) -> bool {
        self.session().is_some()
    }
    pub fn send(&self, text: &str) -> Result<(), WxError> {
        let s = self.session().ok_or_else(|| err("还没有可用的微信会话：要先在微信里给她发一句话"))?;
        let chars: Vec<char> = text.chars().collect();
        for chunk in chars.chunks(MAX_TEXT) {
            let t: String = chunk.iter().collect();
            let body = json!({"msg": {"from_user_id": "", "to_user_id": s.user_id, "client_id": uuid(), "message_type": BOT, "message_state": FINISH,
                "context_token": s.context, "item_list": [{"type": 1, "text_item": {"text": t}}]}, "base_info": {"channel_version": CHANNEL_VERSION}});
            self.request("/ilink/bot/sendmessage", Some(&body), Some(&s.token), None, SEND_TIMEOUT, &[])?;
        }
        Ok(())
    }
    /// "对方正在输入中". Best effort.
    pub fn typing(&self, on: bool) {
        let Some(s) = self.session() else { return };
        let ticket = self.inner.lock().unwrap().ticket.clone();
        let ticket = match ticket {
            Some(t) => t,
            None => {
                let body = json!({"ilink_user_id": s.user_id, "context_token": s.context, "base_info": {"channel_version": CHANNEL_VERSION}});
                match self.request("/ilink/bot/getconfig", Some(&body), Some(&s.token), None, SEND_TIMEOUT, &[]) {
                    Ok(c) => match c["typing_ticket"].as_str() {
                        Some(t) => {
                            self.inner.lock().unwrap().ticket = Some(t.into());
                            t.to_string()
                        }
                        None => return,
                    },
                    Err(_) => return,
                }
            }
        };
        let body = json!({"ilink_user_id": s.user_id, "typing_ticket": ticket, "status": if on { 1 } else { 2 }, "base_info": {"channel_version": CHANNEL_VERSION}});
        if let Err(e) = self.request("/ilink/bot/sendtyping", Some(&body), Some(&s.token), None, SEND_TIMEOUT, &[]) {
            if e.code == Some(-14) {
                self.inner.lock().unwrap().ticket = None;
            }
        }
    }
}
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}
