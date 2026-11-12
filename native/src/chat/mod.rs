//! The chat brain (milestone 2): settings, the brain thread, WeChat and her desktop tools. The UI
//! thread owns a `ChatHost`; everything the brain does comes back as `Out` messages, and `wake` is
//! called after each one so the UI loop can pick them up.
pub mod brain;
pub mod config;
pub mod desk;
pub mod events;
pub mod llm;
pub mod secret;
pub mod text;
pub mod weixin;

use brain::{Brain, In};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

/// What the brain (or WeChat, or a background request) tells the UI.
#[derive(Clone, Debug)]
pub enum Out {
    Say { text: String, channel: String },
    Act(String),
    Typing(bool),
    Notice { text: String, settings: bool },
    State(String),
    /// A message arrived over WeChat.
    Incoming,
    Weixin(weixin::Status),
    Models(Result<Vec<String>, String>),
}

pub struct Shared {
    pub settings: Mutex<config::Settings>,
    pub store: Mutex<events::EventStore>,
    pub weixin: weixin::Weixin,
    pub desk: desk::Desk,
}

pub struct ChatHost {
    pub shared: Arc<Shared>,
    tx: Sender<In>,
    pub rx: Receiver<Out>,
    out: Sender<Out>,
    wake: Arc<dyn Fn() + Send + Sync>,
    proxy: Arc<Mutex<String>>,
}

impl ChatHost {
    /// `dir`: where config.json, events.jsonl, usage.json and weixin.json live.
    pub fn start(dir: PathBuf, weixin_base: Option<String>, wake: Arc<dyn Fn() + Send + Sync>) -> ChatHost {
        let settings = config::Settings::load(dir.clone());
        let proxy = Arc::new(Mutex::new(settings.config.proxy.clone()));
        let store = events::EventStore::open(Some(dir.join("events.jsonl")));
        let (out_tx, out_rx) = channel::<Out>();
        let (wx_tx, wx_rx) = channel();
        let weixin = weixin::Weixin::new(dir, weixin_base, proxy.clone(), wx_tx);
        let shared = Arc::new(Shared { settings: Mutex::new(settings), store: Mutex::new(store), weixin, desk: desk::Desk::find() });
        let (tx, rx) = channel::<In>();
        let emit = {
            let out = out_tx.clone();
            let wake = wake.clone();
            move |o: Out| {
                let _ = out.send(o);
                wake();
            }
        };
        {
            let brain = Brain::new(rx, tx.clone(), Box::new(emit.clone()), shared.clone());
            std::thread::Builder::new().name("brain".into()).spawn(move || brain.run()).ok();
        }
        // WeChat events: messages go to the brain (and perk an ear up), status goes to the UI.
        {
            let tx = tx.clone();
            let emit = emit.clone();
            std::thread::spawn(move || {
                for e in wx_rx {
                    match e {
                        weixin::WxEvent::Message(t) => {
                            emit(Out::Incoming);
                            let _ = tx.send(In::Heard(t, "weixin".into()));
                        }
                        weixin::WxEvent::Status(s) => {
                            if s.state == "expired" {
                                emit(Out::Notice { text: "微信连接过期了，需要重新扫码。".into(), settings: true });
                            }
                            emit(Out::Weixin(s));
                        }
                    }
                }
            });
        }
        shared.weixin.start();
        ChatHost { shared, tx, rx: out_rx, out: out_tx, wake, proxy }
    }
    pub fn send(&self, text: &str) {
        let _ = self.tx.send(In::Heard(text.chars().take(2000).collect(), "desktop".into()));
    }
    pub fn typing(&self) {
        let _ = self.tx.send(In::Typing);
    }
    pub fn stop(&self) {
        let _ = self.tx.send(In::Stop);
        self.shared.weixin.stop();
        self.shared.weixin.cancel_login();
    }
    /// The last lines said or heard, oldest first.
    pub fn history(&self, n: usize) -> Vec<events::Event> {
        let s = self.shared.store.lock().unwrap();
        let talk: Vec<events::Event> = s.recent(n * 4 + 20).iter().filter(|e| e.kind == "heard" || e.kind == "said").cloned().collect();
        talk[talk.len().saturating_sub(n)..].to_vec()
    }
    pub fn update(&self, p: config::Patch) -> Result<(), String> {
        let mut s = self.shared.settings.lock().unwrap();
        s.update(p)?;
        *self.proxy.lock().unwrap() = s.config.proxy.clone();
        Ok(())
    }
    /// Fetches the model list in the background; the answer arrives as `Out::Models`.
    pub fn models(&self, base: String, key: String, proxy: String) {
        let (b, k, p) = {
            let s = self.shared.settings.lock().unwrap();
            (
                if base.trim().is_empty() { s.config.base_url.clone() } else { base },
                if key.trim().is_empty() { s.api_key.clone() } else { key },
                if proxy.trim().is_empty() { s.config.proxy.clone() } else { proxy },
            )
        };
        let out = self.out.clone();
        let wake = self.wake.clone();
        std::thread::spawn(move || {
            let r = llm::normalize_proxy(&p).and_then(|p| llm::list_models(&b, &k, &p).map_err(|e| e.message));
            let _ = out.send(Out::Models(r));
            wake();
        });
    }
}
