//! main.cjs's chat half: the bubble (chat mode with the composer, or a quiet "peek" with just her
//! lines), its settings panel, and what the brain asks the pet to do.
use super::bubble::{Action, Line, Mode};
use super::uiwin::UiEv;
use super::App;
use crate::chat::config::Patch;
use crate::chat::text::DEFAULT_PERSONA;
use crate::chat::Out;

const PEEK_SECS: f64 = 12.0;
const IDLE_SECS: f64 = 45.0;
const PET_ACTIONS: [&str; 7] = ["nod", "shakehead", "happy", "wink", "blink", "dip", "ear"];
const ID_INPUT: u64 = 1;

impl App {
    pub(super) fn chat_ready(&self) -> bool {
        self.chat.is_some() && self.bubble.is_some()
    }
    pub(super) fn bubble_mode(&self) -> Option<Mode> {
        self.bubble.as_ref().and_then(|b| b.v.mode)
    }
    pub(super) fn bubble_visible(&self) -> bool {
        self.bubble.as_ref().is_some_and(|b| b.win.visible())
    }
    pub(super) fn toggle_chat(&mut self) {
        if self.bubble_mode() == Some(Mode::Chat) && self.bubble_visible() {
            self.hide_bubble();
        } else {
            self.show_bubble(Mode::Chat, false);
        }
    }
    pub(super) fn show_bubble(&mut self, mode: Mode, settings: bool) {
        if !self.chat_ready() {
            return;
        }
        if !self.visible {
            self.toggle_visible();
        }
        let b = self.bubble.as_mut().unwrap();
        if mode == Mode::Chat || b.v.mode != Some(Mode::Chat) {
            b.v.mode = Some(mode);
        }
        let chat = b.v.mode == Some(Mode::Chat);
        if chat {
            b.win.st.focus = Some(ID_INPUT);
        }
        if settings {
            self.open_settings();
        }
        self.place_bubble();
        let b = self.bubble.as_ref().unwrap();
        b.win.show(chat);
        self.bubble_hide_at = if chat { None } else { Some(self.now() + PEEK_SECS) };
    }
    pub(super) fn hide_bubble(&mut self) {
        self.bubble_hide_at = None;
        if let Some(b) = self.bubble.as_mut() {
            b.v.mode = None;
            b.v.settings = false;
            b.win.hide();
        }
    }
    /// Draws the bubble and puts its tail on the tip of her ahoge.
    pub(super) fn place_bubble(&mut self) {
        for _ in 0..3 {
            let Some(b) = self.bubble.as_mut() else { return };
            b.win.refresh_scale();
            let actions = b.frame();
            let h = b.height;
            let w = super::bubble::BUBBLE_W;
            let r = self.bounds;
            let s = self.pet.settings.size;
            let cx = r.x + r.width / 2.0;
            let head = r.y + (s * 0.43).round();
            let d = self.display_at(cx, head);
            let a = d.work;
            let x = (cx - w / 2.0).clamp(a.x, (a.x + a.width - w).max(a.x));
            let y = (head - h).clamp(a.y, (a.y + a.height - h).max(a.y));
            let k = self.scale;
            let b = self.bubble.as_mut().unwrap();
            b.win.pos = ((x * k).round() as i32, (y * k).round() as i32);
            b.win.present(h);
            if actions.is_empty() {
                return;
            }
            for a in actions {
                self.bubble_act(a);
            }
        }
    }
    pub(super) fn bubble_event(&mut self, e: UiEv, now: f64) {
        match e {
            UiEv::Active(on) => {
                if on {
                    self.bubble_hide_at = None;
                } else if self.bubble_mode() == Some(Mode::Chat) {
                    self.bubble_hide_at = Some(now + IDLE_SECS);
                }
            }
            UiEv::Close => self.hide_bubble(),
            e => {
                if let Some(b) = self.bubble.as_mut() {
                    b.win.feed(e);
                }
                if self.bubble_visible() {
                    self.place_bubble();
                }
            }
        }
    }
    pub(super) fn open_settings(&mut self) {
        let (Some(chat), Some(b)) = (&self.chat, self.bubble.as_mut()) else { return };
        let v = &mut b.v;
        {
            let s = chat.shared.settings.lock().unwrap();
            v.base.set(&s.config.base_url);
            v.proxy.set(&s.config.proxy);
            v.key.set("");
            v.key.placeholder = if s.api_key.is_empty() { "sk-...".into() } else { "已保存（留空不改）".into() };
            v.model.set(&s.config.model);
            v.persona.set(if s.config.persona.is_empty() { DEFAULT_PERSONA } else { &s.config.persona });
            v.persona.scroll = 0.0;
            v.persona.caret = 0;
            v.persona.anchor = 0;
            v.daily.set(&s.config.daily_tokens.to_string());
            let enc = crate::chat::secret::available();
            v.usage = format!("今天已用 {} token{}", s.usage().0, if enc { "" } else { " · 系统加密不可用，无法保存密钥" });
        }
        v.error.clear();
        v.models_open = false;
        let st = chat.shared.weixin.status();
        set_weixin(v, st);
        v.settings = true;
        v.settings_scroll = 0.0;
        v.mode = Some(Mode::Chat);
    }
    fn save_settings(&mut self) {
        let (Some(chat), Some(b)) = (&self.chat, self.bubble.as_mut()) else { return };
        let v = &mut b.v;
        let persona = v.persona.value();
        let persona = if persona.trim() == DEFAULT_PERSONA.trim() { String::new() } else { persona.trim().to_string() };
        let key = v.key.value();
        let patch = Patch {
            base_url: Some(v.base.value()),
            model: Some(v.model.value()),
            persona: Some(persona),
            daily_tokens: v.daily.value().trim().parse::<f64>().ok(),
            proxy: Some(v.proxy.value()),
            api_key: if key.trim().is_empty() { None } else { Some(key) },
        };
        match chat.update(patch) {
            Ok(()) => {
                v.settings = false;
                v.error.clear();
                b.win.st.focus = Some(ID_INPUT);
                b.add_line(Line { who: "notice", text: "设置已保存".into(), channel: String::new(), settings: false });
            }
            Err(e) => v.error = e,
        }
    }
    pub(super) fn bubble_act(&mut self, a: Action) {
        let now = self.now();
        match a {
            Action::Send(text) => {
                let text = text.trim().to_string();
                if text.is_empty() {
                    return;
                }
                if let Some(c) = &self.chat {
                    c.send(&text);
                }
                if let Some(b) = self.bubble.as_mut() {
                    b.v.input.set("");
                    b.add_line(Line { who: "me", text, channel: String::new(), settings: false });
                }
            }
            Action::Typing => {
                if now - self.typing_sent > 1.0 {
                    self.typing_sent = now;
                    if let Some(c) = &self.chat {
                        c.typing();
                    }
                }
            }
            Action::ToggleSettings => {
                if self.bubble.as_ref().is_some_and(|b| b.v.settings) {
                    if let Some(b) = self.bubble.as_mut() {
                        b.v.settings = false;
                        b.win.st.focus = Some(ID_INPUT);
                    }
                } else {
                    self.open_settings();
                }
            }
            Action::OpenSettings => self.open_settings(),
            Action::Close => self.hide_bubble(),
            Action::Save => self.save_settings(),
            Action::ResetPersona => {
                if let Some(b) = self.bubble.as_mut() {
                    b.v.persona.set(DEFAULT_PERSONA);
                }
            }
            Action::FetchModels => {
                if let (Some(c), Some(b)) = (&self.chat, self.bubble.as_mut()) {
                    b.v.error.clear();
                    b.v.usage = "正在获取模型列表…".into();
                    c.models(b.v.base.value(), b.v.key.value(), b.v.proxy.value());
                }
            }
            Action::Weixin => {
                if let Some(c) = &self.chat {
                    let wx = &c.shared.weixin;
                    match wx.status().state.as_str() {
                        "qr" | "scanned" => wx.cancel_login(),
                        "connected" | "retrying" => wx.logout(),
                        _ => wx.login(),
                    }
                }
            }
        }
    }
    fn add_line(&mut self, line: Line) {
        if let Some(b) = self.bubble.as_mut() {
            b.add_line(line);
        }
    }
    pub(super) fn chat_out(&mut self, o: Out) {
        let now = self.now();
        match o {
            Out::Say { text, channel } => {
                if channel != "desktop" {
                    self.pet.action("ear", now);
                }
                self.add_line(Line { who: "her", text, channel, settings: false });
                self.show_bubble(Mode::Peek, false);
            }
            Out::Act(a) => {
                if PET_ACTIONS.contains(&a.as_str()) {
                    self.pet.action(&a, now);
                }
            }
            Out::Typing(on) => {
                if let Some(b) = self.bubble.as_mut() {
                    b.v.typing = on;
                }
                if self.bubble_visible() {
                    self.place_bubble();
                }
            }
            Out::Notice { text, settings } => {
                self.add_line(Line { who: "notice", text: if settings { format!("{text}（点这里打开设置）") } else { text }, channel: String::new(), settings });
                self.show_bubble(if settings { Mode::Chat } else { Mode::Peek }, settings);
            }
            Out::State(s) => {
                if s == "thinking" {
                    self.pet.action("ear", now);
                }
            }
            Out::Incoming => self.pet.action("ear", now),
            Out::Weixin(s) => {
                if let Some(b) = self.bubble.as_mut() {
                    set_weixin(&mut b.v, s);
                }
                if self.bubble_visible() {
                    self.place_bubble();
                }
            }
            Out::Models(r) => {
                if let Some(b) = self.bubble.as_mut() {
                    match r {
                        Ok(list) if list.is_empty() => b.v.error = "接口没有返回模型".into(),
                        Ok(list) => {
                            b.v.usage = format!("可用模型：{}", list.join("、"));
                            b.v.models = list;
                            b.v.models_open = true;
                        }
                        Err(e) => {
                            b.v.usage.clear();
                            b.v.error = e;
                        }
                    }
                }
                if self.bubble_visible() {
                    self.place_bubble();
                }
            }
        }
    }
    pub(super) fn pump_chat(&mut self) {
        loop {
            let next = self.chat.as_ref().and_then(|c| c.rx.try_recv().ok());
            let Some(o) = next else { break };
            self.chat_out(o);
        }
    }
    pub(super) fn chat_tick(&mut self, now: f64) {
        if self.bubble_hide_at.is_some_and(|t| now >= t) {
            self.hide_bubble();
        }
    }
}

fn set_weixin(v: &mut super::bubble::View, s: crate::chat::weixin::Status) {
    let show_qr = matches!(s.state.as_str(), "qr" | "scanned") && s.url.is_some();
    v.qr = if show_qr {
        qrcode::QrCode::new(s.url.as_deref().unwrap_or("").as_bytes()).ok().map(|q| (q.width(), q.to_colors().into_iter().map(|c| c == qrcode::Color::Dark).collect()))
    } else {
        None
    };
    v.wx = s;
}
