//! bubble.html / bubble.css: the chat bubble above her head, drawn with the ui kit. Her lines, the
//! owner's, notices, the typing dots, the composer, and the settings panel inside the card.
use super::uiwin::UiWin;
use crate::chat::weixin::Status as WxStatus;
use crate::ui::widgets::{Key, TextEdit, Ui};
use crate::ui::*;

pub const BUBBLE_W: f64 = 340.0;
pub const MAX_H: f64 = 980.0;
const CARD_X: f64 = 10.0;
const CARD_W: f64 = BUBBLE_W - 20.0;
const PAD: f64 = 12.0;
const INNER: f64 = CARD_W - 2.0 * PAD;
const LOG_MAX: f64 = 240.0;
const MAX_LINES: usize = 8;
const SETTINGS_MAX: f64 = 540.0;
const SITE_NOTE: &str = "原生版暂不支持扫码登录（需要内嵌浏览器），需要时先用旧版。";

#[derive(Clone, Debug)]
pub struct Line {
    /// me, her, notice
    pub who: &'static str,
    pub text: String,
    pub channel: String,
    pub settings: bool,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Chat,
    Peek,
}
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Send(String),
    Typing,
    ToggleSettings,
    OpenSettings,
    Close,
    Save,
    ResetPersona,
    FetchModels,
    Weixin,
}

pub struct View {
    pub lines: Vec<Line>,
    pub typing: bool,
    pub mode: Option<Mode>,
    pub settings: bool,
    pub input: TextEdit,
    pub base: TextEdit,
    pub proxy: TextEdit,
    pub key: TextEdit,
    pub model: TextEdit,
    pub persona: TextEdit,
    pub daily: TextEdit,
    pub models: Vec<String>,
    pub models_open: bool,
    pub wx: WxStatus,
    pub qr: Option<(usize, Vec<bool>)>,
    pub usage: String,
    pub error: String,
    pub log_scroll: f64,
    pub stick_bottom: bool,
    pub settings_scroll: f64,
}
pub struct Bubble {
    pub win: UiWin,
    pub v: View,
    pub height: f64,
}

const ID_INPUT: u64 = 1;
const ID_SEND: u64 = 2;
const ID_GEAR: u64 = 3;
const ID_WX: u64 = 10;
const ID_BASE: u64 = 11;
const ID_PROXY: u64 = 12;
const ID_KEY: u64 = 13;
const ID_MODEL: u64 = 14;
const ID_FETCH: u64 = 15;
const ID_PERSONA: u64 = 16;
const ID_DAILY: u64 = 17;
const ID_RESET: u64 = 18;
const ID_SAVE: u64 = 19;
const ID_MODELS: u64 = 100;
const ID_NOTICE: u64 = 300;

impl Bubble {
    pub fn create() -> Option<Bubble> {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::*;
        let win = UiWin::create(w!("BluefishBubble"), w!("小鱼"), true, WS_POPUP, WS_EX_TOOLWINDOW | WS_EX_TOPMOST, 340, 120)?;
        let mut v = View {
            lines: Vec::new(),
            typing: false,
            mode: None,
            settings: false,
            input: TextEdit::new("和小鱼说点什么", 500),
            base: TextEdit::new("https://api.deepseek.com", 300),
            proxy: TextEdit::new("http://127.0.0.1:7897", 300),
            key: TextEdit::new("sk-...", 400),
            model: TextEdit::new("deepseek-flash", 120),
            persona: TextEdit::new("", 2000),
            daily: TextEdit::new("200000", 9),
            models: Vec::new(),
            models_open: false,
            wx: WxStatus { state: "off".into(), ..WxStatus::default() },
            qr: None,
            usage: String::new(),
            error: String::new(),
            log_scroll: 0.0,
            stick_bottom: true,
            settings_scroll: 0.0,
        };
        v.key.password = true;
        v.persona.multiline = true;
        Some(Bubble { win, v, height: 120.0 })
    }
    pub fn add_line(&mut self, line: Line) {
        self.v.lines.push(line);
        let n = self.v.lines.len();
        if n > MAX_LINES {
            self.v.lines.drain(..n - MAX_LINES);
        }
        self.v.stick_bottom = true;
    }
    /// Renders the bubble; returns the height it used (CSS px) and what was asked.
    pub fn frame(&mut self) -> Vec<Action> {
        self.win.size = (BUBBLE_W, MAX_H);
        self.win.theme = if system_dark() { DARK } else { LIGHT };
        let v = &mut self.v;
        let mut actions = Vec::new();
        let mut used = 0.0;
        self.win.draw(|ui| {
            used = draw(ui, v, &mut actions);
        });
        self.height = used;
        actions
    }
}

fn line_metrics(l: &Line) -> (f64, f64) {
    let notice = l.who == "notice";
    let f = if notice { SMALL } else { BODY };
    let tag = tag_w(l);
    let max = if notice { INNER } else { INNER * 0.86 - 22.0 - tag };
    let (w, h) = measure(&l.text, f, max, true);
    if notice {
        (INNER, h.max(18.0))
    } else {
        ((w + tag).ceil() + 22.0, h.max(22.0) + 10.0)
    }
}
fn tag_w(l: &Line) -> f64 {
    match channel_label(&l.channel) {
        Some(t) => measure(t, Font { size: 11.0, weight: 500, mono: false }, 100.0, false).0 + 16.0,
        None => 0.0,
    }
}
fn channel_label(c: &str) -> Option<&'static str> {
    match c {
        "weixin" => Some("微信"),
        "qq" => Some("QQ"),
        _ => None,
    }
}

fn draw(ui: &mut Ui, v: &mut View, actions: &mut Vec<Action>) -> f64 {
    let t = ui.t();
    let chat = v.mode == Some(Mode::Chat);
    // Measure the column first: log, typing, composer, settings.
    let gap = 8.0;
    let log_h_full: f64 = v.lines.iter().map(|l| line_metrics(l).1).sum::<f64>() + 6.0 * (v.lines.len().saturating_sub(1)) as f64;
    let log_h = log_h_full.min(LOG_MAX);
    let typing_h = if v.typing { 24.0 } else { 0.0 };
    let composer_h = if chat { 38.0 } else { 0.0 };
    let settings_full = if v.settings && chat { settings_height(v) } else { 0.0 };
    let settings_h = settings_full.min(SETTINGS_MAX);
    let parts = [log_h, typing_h, composer_h, settings_h].iter().filter(|h| **h > 0.0).count();
    let content = log_h + typing_h + composer_h + settings_h + gap * parts.saturating_sub(1) as f64;
    let card_h = PAD + content.max(18.0) + 8.0;
    let (cx, cy) = (CARD_X, 10.0);
    ui.p.clear(None);
    // .card.bubble: r-pop, 0 4px 14px -6px rgb(0 0 0 / 22%); the tail below it.
    ui.p.shadow(cx, cy, CARD_W, card_h, R_POP, 4.0, 14.0, -6.0, 0.22);
    ui.p.rrect(cx, cy, CARD_W, card_h, R_POP, t.card);
    let tail_x = BUBBLE_W / 2.0;
    let tail_y = cy + card_h - 0.5;
    ui.p.figure(
        &[icons::Figure { start: (tail_x - 9.0, tail_y), segs: vec![icons::Seg::Line(tail_x + 9.0, tail_y), icons::Seg::Line(tail_x, tail_y + 9.0)], closed: true }],
        t.card,
    );
    let mut y = cy + PAD;
    let x0 = cx + PAD;
    // ---- log ----
    if log_h > 0.0 {
        let max_scroll = (log_h_full - log_h).max(0.0);
        if v.stick_bottom {
            v.log_scroll = max_scroll;
        }
        if ui.hover(x0, y, INNER, log_h) && ui.input.wheel != 0.0 {
            v.log_scroll = (v.log_scroll - ui.input.wheel * 0.4).clamp(0.0, max_scroll);
            v.stick_bottom = v.log_scroll >= max_scroll - 1.0;
            ui.input.wheel = 0.0;
        }
        ui.p.clip(x0 - 2.0, y, INNER + 4.0, log_h);
        let mut ly = y - v.log_scroll;
        for (i, l) in v.lines.iter().enumerate() {
            let (w, h) = line_metrics(l);
            if ly + h >= y && ly <= y + log_h {
                match l.who {
                    "notice" => {
                        let c = if l.settings { t.ink } else { t.muted };
                        ui.p.text(&l.text, x0, ly, INNER, SMALL, c, Align::Center, true);
                        if l.settings {
                            let (_, clicked) = ui.area(ID_NOTICE + i as u64, x0, ly, INNER, h);
                            if clicked {
                                actions.push(Action::OpenSettings);
                            }
                        }
                    }
                    who => {
                        let me = who == "me";
                        let bx = if me { x0 + INNER - w } else { x0 };
                        let (bg, fg) = if me { (t.ink, t.on_ink) } else { (t.fill, t.ink) };
                        let r = if me { [14.0, 14.0, 5.0, 14.0] } else { [14.0, 14.0, 14.0, 5.0] };
                        ui.p.rrect4(bx, ly, w, h, r, bg);
                        let mut tx = bx + 11.0;
                        if let Some(tag) = channel_label(&l.channel) {
                            let tw = tag_w(l) - 6.0;
                            ui.p.rrect(tx, ly + 7.5, tw, 17.0, 5.0, if me { Color::hex(0xffffff).alpha(0.24) } else { t.card });
                            ui.p.text(tag, tx, ly + 7.5, tw, Font { size: 11.0, weight: 500, mono: false }, if me { Color::hex(0xffffff) } else { t.ink2 }, Align::Center, false);
                            tx += tw + 6.0;
                        }
                        ui.p.text(&l.text, tx, ly + 5.0, w - (tx - bx) - 11.0 + 1.0, BODY, fg, Align::Left, true);
                    }
                }
            }
            ly += h + 6.0;
        }
        ui.p.unclip();
        y += log_h + gap;
    }
    // ---- typing dots ----
    if v.typing {
        ui.p.rrect(x0, y, 42.0, 24.0, 12.0, t.fill);
        let now = ui.input.time;
        for k in 0..3 {
            let ph = ((now - 0.15 * k as f64) % 1.0 + 1.0) % 1.0;
            let up = if ph < 0.3 { ph / 0.3 } else if ph < 0.6 { 1.0 - (ph - 0.3) / 0.3 } else { 0.0 };
            ui.p.circle(x0 + 12.0 + 9.0 * k as f64, y + 12.0 - 2.0 * up, 3.0, t.muted.alpha((0.35 + 0.65 * up) as f32));
        }
        ui.st.wants_blink = true;
        y += typing_h + gap;
    }
    // ---- composer ----
    if chat {
        let w = INNER - 76.0;
        let focus = ui.st.focus == Some(ID_INPUT);
        ui.p.rrect(x0, y + 1.0, w, 36.0, 18.0, if focus { t.fill } else { t.fill_soft });
        let ev = ui.text_edit(ID_INPUT, x0 + 12.0, y + 1.0, w - 24.0, 36.0, &mut v.input, BODY, t.ink);
        if ev.changed {
            actions.push(Action::Typing);
        }
        if ev.submitted {
            actions.push(Action::Send(v.input.value()));
        }
        if ui.icon_button_sized(ID_SEND, x0 + w, y, 38.0, "send", false, false) {
            actions.push(Action::Send(v.input.value()));
        }
        if ui.icon_button_sized(ID_GEAR, x0 + w + 38.0, y, 38.0, "gear", v.settings, false) {
            actions.push(Action::ToggleSettings);
        }
        y += composer_h + gap;
    }
    // ---- settings ----
    if v.settings && chat {
        let max = (settings_full - settings_h).max(0.0);
        if ui.hover(x0, y, INNER, settings_h) && ui.input.wheel != 0.0 && ui.st.focus != Some(ID_PERSONA) {
            v.settings_scroll = (v.settings_scroll - ui.input.wheel * 0.5).clamp(0.0, max);
            ui.input.wheel = 0.0;
        }
        v.settings_scroll = v.settings_scroll.clamp(0.0, max);
        ui.p.clip(x0 - 6.0, y, INNER + 12.0, settings_h);
        ui.st.clip = Some((x0 - 6.0, y, INNER + 12.0, settings_h));
        draw_settings(ui, v, x0, y - v.settings_scroll, actions);
        ui.st.clip = None;
        ui.p.unclip();
        if max > 0.0 {
            // A thin scroll thumb, like the rail scrollbar in style.css.
            let th = settings_h * settings_h / settings_full;
            let ty = y + (settings_h - th) * v.settings_scroll / max;
            ui.p.rrect(x0 + INNER + 4.0, ty, 4.0, th, 2.0, Color::hex(0xd4d4d4));
        }
    }
    if ui.input.keys.iter().any(|k| k.0 == Key::Escape) {
        actions.push(if v.settings { Action::ToggleSettings } else { Action::Close });
    }
    cy + card_h + 9.0 + 2.0
}

fn field_h(multi: bool) -> f64 {
    if multi {
        112.0
    } else {
        34.0
    }
}
fn settings_height(v: &View) -> f64 {
    let mut h = 4.0;
    // WeChat block
    h += 36.0;
    if v.qr.is_some() {
        h += 6.0 + 192.0;
    }
    if !wx_hint(&v.wx).is_empty() {
        h += 6.0 + measure(&wx_hint(&v.wx), SMALL, INNER, true).1;
    }
    h += 8.0 + 1.0 + 8.0;
    // B站 block
    h += 36.0 + 6.0 + measure(SITE_NOTE, SMALL, INNER, true).1 + 8.0 + 1.0 + 8.0;
    // fields: label (18) + 2 + box, gap 8
    for multi in [false, false, false, false, true, false] {
        h += 18.0 + 2.0 + field_h(multi) + 8.0;
    }
    if v.models_open && !v.models.is_empty() {
        h += 30.0 * v.models.len().min(8) as f64 + 8.0 + 6.0;
    }
    h += measure(&v.usage, SMALL, INNER, true).1.max(18.0) + 8.0;
    if !v.error.is_empty() {
        h += measure(&v.error, SMALL, INNER, true).1 + 8.0;
    }
    h + 36.0
}
fn wx_text(s: &str) -> &str {
    match s {
        "off" => "未连接",
        "qr" => "等待扫码",
        "scanned" => "已扫码，请在手机上确认",
        "connected" => "已连接",
        "retrying" => "连接不稳，正在重试",
        "expired" => "连接过期了，请重新扫码",
        "error" => "连接失败",
        other => other,
    }
}
fn wx_hint(s: &WxStatus) -> String {
    let qr = matches!(s.state.as_str(), "qr" | "scanned") && s.url.is_some();
    if qr {
        if s.state == "scanned" {
            "在手机微信里点确认。".into()
        } else {
            "用你自己的微信扫一扫。这是腾讯官方的 ClawBot 接口，不需要小号。".into()
        }
    } else if s.state == "connected" && !s.can_send {
        "连上了。先在微信里给她发一句话，她才能回你。".into()
    } else if s.state == "error" {
        s.message.clone().unwrap_or_default()
    } else {
        String::new()
    }
}

fn input_box(ui: &mut Ui, id: u64, x: f64, y: f64, w: f64, e: &mut TextEdit) -> bool {
    let t = ui.t();
    let h = field_h(e.multiline);
    let focus = ui.st.focus == Some(id);
    ui.p.rrect(x, y, w, h, R_MENU, t.card);
    ui.p.rrect_stroke(x, y, w, h, R_MENU, if focus { t.focus } else { t.line }, 1.0);
    let f = Font { size: 13.0, weight: 400, mono: false };
    let pad_y = if e.multiline { 6.0 } else { 0.0 };
    ui.text_edit(id, x + 10.0, y + pad_y, w - 20.0, h - 2.0 * pad_y, e, f, t.ink).submitted
}

fn draw_settings(ui: &mut Ui, v: &mut View, x0: f64, mut y: f64, actions: &mut Vec<Action>) {
    let t = ui.t();
    ui.p.line(x0, y, x0 + INNER, y, t.line, 1.0);
    y += 4.0 + 1.0;
    // ---- WeChat ----
    ui.p.text("微信", x0, y + 8.0, 40.0, Font { size: 13.0, weight: 600, mono: false }, t.ink, Align::Left, false);
    ui.p.text(wx_text(&v.wx.state), x0 + 40.0, y + 9.0, INNER - 140.0, SMALL, t.muted, Align::Left, false);
    let qr_on = v.qr.is_some();
    let label = if qr_on {
        "取消"
    } else if matches!(v.wx.state.as_str(), "connected" | "retrying") {
        "断开"
    } else {
        "连接微信"
    };
    if ui.outline_pill(ID_WX, x0 + INNER - 92.0, y, 92.0, 36.0, label, false) {
        actions.push(Action::Weixin);
    }
    y += 36.0;
    if let Some((n, cells)) = &v.qr {
        y += 6.0;
        let side = 192.0;
        let qx = x0 + (INNER - side) / 2.0;
        ui.p.rrect(qx, y, side, side, R_MENU, Color::hex(0xffffff));
        let cell = 180.0 / (*n as f64 + 4.0);
        for yy in 0..*n {
            for xx in 0..*n {
                if cells[yy * n + xx] {
                    ui.p.rrect(qx + 6.0 + (xx as f64 + 2.0) * cell, y + 6.0 + (yy as f64 + 2.0) * cell, cell + 0.4, cell + 0.4, 0.0, Color::hex(0x111111));
                }
            }
        }
        y += side;
    }
    let hint = wx_hint(&v.wx);
    if !hint.is_empty() {
        y += 6.0;
        y += ui.p.text(&hint, x0, y, INNER, SMALL, if v.wx.state == "error" { t.danger } else { t.muted }, Align::Left, true);
    }
    y += 8.0;
    ui.p.line(x0, y, x0 + INNER, y, t.line, 1.0);
    y += 1.0 + 8.0;
    // ---- B站 (needs an embedded browser: not in the native build yet) ----
    ui.p.text("B站", x0, y + 8.0, 40.0, Font { size: 13.0, weight: 600, mono: false }, t.ink, Align::Left, false);
    ui.p.text("未登录", x0 + 40.0, y + 9.0, INNER - 140.0, SMALL, t.muted, Align::Left, false);
    ui.p.rrect(x0 + INNER - 92.0, y, 92.0, 36.0, 18.0, t.card);
    ui.p.rrect_stroke(x0 + INNER - 92.0, y, 92.0, 36.0, 18.0, t.line, 1.0);
    ui.p.text("扫码登录", x0 + INNER - 92.0, y + 8.0, 92.0, LABEL, t.faint, Align::Center, false);
    y += 36.0 + 6.0;
    y += ui.p.text(SITE_NOTE, x0, y, INNER, SMALL, t.muted, Align::Left, true) + 8.0;
    ui.p.line(x0, y, x0 + INNER, y, t.line, 1.0);
    y += 1.0 + 8.0;
    // ---- fields ----
    let label = |ui: &mut Ui, y: f64, s: &str| {
        ui.p.text(s, x0, y, INNER, LABEL, t.ink2, Align::Left, false);
    };
    let mut submit = false;
    for (id, name) in [(ID_BASE, "接口地址"), (ID_PROXY, "代理（可选）"), (ID_KEY, "API Key")] {
        label(ui, y, name);
        y += 20.0;
        let e = match id {
            ID_BASE => &mut v.base,
            ID_PROXY => &mut v.proxy,
            _ => &mut v.key,
        };
        submit |= input_box(ui, id, x0, y, INNER, e);
        y += field_h(false) + 8.0;
    }
    label(ui, y, "模型");
    y += 20.0;
    submit |= input_box(ui, ID_MODEL, x0, y, INNER - 86.0, &mut v.model);
    if ui.outline_pill(ID_FETCH, x0 + INNER - 80.0, y - 1.0, 80.0, 36.0, "获取列表", false) {
        actions.push(Action::FetchModels);
    }
    y += field_h(false) + 8.0;
    if v.models_open && !v.models.is_empty() {
        let shown: Vec<String> = v.models.iter().take(8).cloned().collect();
        let cur = v.model.value();
        if let Some(i) = ui.select_list(ID_MODELS, x0, y - 4.0, INNER - 86.0, &shown, &cur, 30.0) {
            v.model.set(&shown[i]);
            v.models_open = false;
        }
        y += 30.0 * shown.len() as f64 + 8.0 + 6.0;
    }
    label(ui, y, "人设");
    y += 20.0;
    input_box(ui, ID_PERSONA, x0, y, INNER, &mut v.persona);
    y += field_h(true) + 8.0;
    label(ui, y, "每天最多用多少 token");
    y += 20.0;
    v.daily.text.retain(|c| (b'0' as u16..=b'9' as u16).contains(c));
    submit |= input_box(ui, ID_DAILY, x0, y, INNER, &mut v.daily);
    y += field_h(false) + 8.0;
    let uh = ui.p.text(&v.usage, x0, y, INNER, SMALL, t.muted, Align::Left, true);
    y += uh.max(18.0) + 8.0;
    if !v.error.is_empty() {
        y += ui.p.text(&v.error, x0, y, INNER, SMALL, t.danger, Align::Left, true) + 8.0;
    }
    // ---- actions ----
    if ui.outline_pill(ID_SAVE, x0 + INNER - 64.0, y, 64.0, 36.0, "保存", true) {
        actions.push(Action::Save);
    }
    if ui.outline_pill(ID_RESET, x0 + INNER - 64.0 - 8.0 - 104.0, y, 104.0, 36.0, "恢复默认人设", false) {
        actions.push(Action::ResetPersona);
    }
    if submit {
        actions.push(Action::Save);
    }
}
