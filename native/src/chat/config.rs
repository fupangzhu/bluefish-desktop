//! desktop/brain.cjs: the chat settings (model endpoint, key, persona, daily budget, proxy) and the
//! daily token count. On the first run the Electron build's settings, key and history are imported.
use super::llm::normalize_proxy;
use super::secret;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const DEFAULT_BASE: &str = "https://api.deepseek.com";
pub const DEFAULT_MODEL: &str = "deepseek-flash";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    #[serde(rename = "baseUrl", default = "default_base")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(rename = "cheapModel", default)]
    pub cheap_model: String,
    #[serde(default)]
    pub persona: String,
    #[serde(rename = "dailyTokens", default = "default_daily")]
    pub daily_tokens: u64,
    #[serde(default)]
    pub proxy: String,
    /// The key, DPAPI-protected (base64).
    #[serde(rename = "apiKeyDpapi", default, skip_serializing_if = "String::is_empty")]
    pub api_key_dpapi: String,
}
fn default_base() -> String {
    DEFAULT_BASE.into()
}
fn default_model() -> String {
    DEFAULT_MODEL.into()
}
fn default_daily() -> u64 {
    200_000
}
impl Default for Config {
    fn default() -> Self {
        Config {
            base_url: default_base(),
            model: default_model(),
            cheap_model: String::new(),
            persona: String::new(),
            daily_tokens: default_daily(),
            proxy: String::new(),
            api_key_dpapi: String::new(),
        }
    }
}

/// What the settings form sends back. None = leave unchanged.
#[derive(Clone, Debug, Default)]
pub struct Patch {
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub persona: Option<String>,
    pub daily_tokens: Option<f64>,
    pub proxy: Option<String>,
    pub api_key: Option<String>,
}

pub struct Settings {
    pub dir: PathBuf,
    pub config: Config,
    pub api_key: String,
}
fn read_json(p: &Path) -> Option<serde_json::Value> {
    serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}
pub fn write_json(p: &Path, v: &impl Serialize) -> std::io::Result<()> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v)?)?;
    std::fs::rename(tmp, p)
}

impl Settings {
    pub fn load(dir: PathBuf) -> Settings {
        let file = dir.join("config.json");
        if !file.exists() {
            import_electron(&dir);
        }
        let config: Config = read_json(&file).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        let api_key = if config.api_key_dpapi.is_empty() { String::new() } else { secret::unprotect(&config.api_key_dpapi).unwrap_or_default() };
        Settings { dir, config, api_key }
    }
    pub fn save(&mut self) -> Result<(), String> {
        if !self.api_key.is_empty() {
            self.config.api_key_dpapi = secret::protect(&self.api_key).ok_or("系统加密不可用，无法安全保存 API Key")?;
        } else {
            self.config.api_key_dpapi.clear();
        }
        write_json(&self.dir.join("config.json"), &self.config).map_err(|e| e.to_string())
    }
    pub fn update(&mut self, p: Patch) -> Result<(), String> {
        let cut = |s: &str, n: usize| s.trim().chars().take(n).collect::<String>();
        if let Some(u) = p.base_url {
            let u = cut(&u, 300);
            let lower = u.to_ascii_lowercase();
            if !u.is_empty() && !lower.starts_with("http://") && !lower.starts_with("https://") {
                return Err("接口地址要以 http:// 或 https:// 开头".into());
            }
            self.config.base_url = if u.is_empty() { DEFAULT_BASE.into() } else { u };
        }
        if let Some(m) = p.model {
            let m = cut(&m, 120);
            self.config.model = if m.is_empty() { DEFAULT_MODEL.into() } else { m };
        }
        if let Some(t) = p.persona {
            self.config.persona = t.chars().take(2000).collect();
        }
        if let Some(n) = p.daily_tokens.filter(|n| n.is_finite()) {
            self.config.daily_tokens = n.round().clamp(0.0, 5e6) as u64;
        }
        if let Some(x) = p.proxy {
            self.config.proxy = normalize_proxy(&cut(&x, 300))?;
        }
        if let Some(k) = p.api_key.map(|k| cut(&k, 400)).filter(|k| !k.is_empty()) {
            self.api_key = k;
        }
        self.save()
    }
    // ---- daily budget ----
    fn today() -> String {
        let (y, m, d, ..) = super::text::local(super::text::now_ms());
        format!("{y}-{m}-{d}")
    }
    pub fn usage(&self) -> (u64, u64) {
        match read_json(&self.dir.join("usage.json")) {
            Some(u) if u["day"].as_str() == Some(&Self::today()) => (u["tokens"].as_u64().unwrap_or(0), u["calls"].as_u64().unwrap_or(0)),
            _ => (0, 0),
        }
    }
    pub fn exhausted(&self) -> bool {
        self.config.daily_tokens > 0 && self.usage().0 >= self.config.daily_tokens
    }
    pub fn spend(&self, tokens: u64) {
        let (t, c) = self.usage();
        let _ = write_json(&self.dir.join("usage.json"), &serde_json::json!({"day": Self::today(), "tokens": t + tokens, "calls": c + 1}));
    }
}

/// The Electron build's folder (%APPDATA%\bluefish-complete).
pub fn electron_dir() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("APPDATA")?).join("bluefish-complete"))
}
/// First run: bring over the Electron build's chat settings, key, WeChat link and history.
fn import_electron(dir: &Path) {
    let Some(user) = electron_dir() else { return };
    let old = user.join("brain");
    let Some(saved) = read_json(&old.join("config.json")) else { return };
    let mut c: Config = serde_json::from_value(saved.clone()).unwrap_or_default();
    if let Some(enc) = saved["apiKeyEnc"].as_str() {
        if let Some(key) = secret::electron_decrypt(&user, enc) {
            c.api_key_dpapi = secret::protect(&key).unwrap_or_default();
        }
    }
    let _ = write_json(&dir.join("config.json"), &c);
    if let Some(mut wx) = read_json(&old.join("weixin.json")) {
        if let Some(token) = wx["tokenEnc"].as_str().and_then(|t| secret::electron_decrypt(&user, t)) {
            wx["tokenDpapi"] = serde_json::Value::from(secret::protect(&token).unwrap_or_default());
            if let Some(o) = wx.as_object_mut() {
                o.remove("tokenEnc");
            }
            let _ = write_json(&dir.join("weixin.json"), &wx);
        }
    }
    let _ = std::fs::copy(old.join("events.jsonl"), dir.join("events.jsonl"));
}
