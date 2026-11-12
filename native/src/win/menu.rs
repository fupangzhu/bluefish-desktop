//! menu.html / menu.css: the right-click card. Size slider with its number; follow, idle and dock
//! toggles; chat, hide and quit.
use super::uiwin::UiWin;
use crate::pet::Settings;
use crate::ui::widgets::Key;
use crate::ui::*;

pub const MENU_W: f64 = 280.0;
pub const MENU_H: f64 = 200.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    Size(f64),
    Follow,
    Idle,
    Docked,
    Chat,
    Hide,
    Quit,
    Close,
}

pub struct Menu {
    pub win: UiWin,
    pub shown_at: f64,
    /// The slider value while it is being dragged (sent to the pet a frame at a time).
    dragging: Option<f64>,
}
impl Menu {
    pub fn create() -> Option<Menu> {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::*;
        let win = UiWin::create(w!("BluefishMenu"), w!("蓝色肥鱼菜单"), true, WS_POPUP, WS_EX_TOOLWINDOW | WS_EX_TOPMOST, 280, 200)?;
        Some(Menu { win, shown_at: -1.0, dragging: None })
    }
    pub fn frame(&mut self, s: Settings, visible: bool) -> Vec<Action> {
        self.win.size = (MENU_W, MENU_H);
        self.win.theme = LIGHT;
        let mut out = Vec::new();
        let dragging = &mut self.dragging;
        self.win.render(|ui| {
            let t = ui.t();
            ui.p.clear(None);
            // .card.menu: margin 10, padding 16, r-pop, box-shadow 3px 5px 8px -5px #0000001a.
            let (cx, cy, cw, ch) = (10.0, 10.0, MENU_W - 20.0, MENU_H - 20.0);
            ui.p.shadow(cx + 3.0, cy, cw, ch, R_POP, 5.0, 10.0, -3.0, 0.16);
            ui.p.rrect(cx, cy, cw, ch, R_POP, t.card);
            let (x0, w) = (cx + 16.0, cw - 32.0);
            // Size row.
            let mut y = cy + 16.0;
            ui.p.icon("size", x0, y + 13.0, 18.0, t.ink);
            let shown = dragging.unwrap_or(s.size);
            let (sx, sw) = (x0 + 28.0, w - 28.0 - 46.0);
            if let Some(v) = ui.slider(1, sx, y + 10.0, sw, shown, 150.0, 460.0, 1.0) {
                *dragging = Some(v);
                out.push(Action::Size(v));
            }
            if ui.st.active != Some(1) {
                *dragging = None;
            }
            ui.p.text(&format!("{}", shown.round()), x0 + w - 36.0, y + 9.0, 36.0, NUM, t.ink, Align::Right, false);
            y += 44.0 + 4.0;
            // Toggles: three 44 px buttons, spaced across the row.
            let gap = (w - 3.0 * 44.0) / 2.0;
            for (i, (icon, on, a)) in [("follow", s.follow, Action::Follow), ("idle", s.idle, Action::Idle), ("dock", s.docked, Action::Docked)].into_iter().enumerate() {
                if ui.icon_button(10 + i as u64, x0 + i as f64 * (44.0 + gap), y, icon, on, false) {
                    out.push(a);
                }
            }
            y += 44.0 + 4.0 + 8.0;
            // Utilities, right-aligned.
            let utils = [("chat", Action::Chat, false), (if visible { "hide" } else { "follow" }, Action::Hide, false), ("quit", Action::Quit, true)];
            for (i, (icon, a, danger)) in utils.into_iter().enumerate() {
                let x = x0 + w - 44.0 * (3 - i) as f64 - 8.0 * (2 - i) as f64;
                if ui.icon_button(20 + i as u64, x, y, icon, false, danger) {
                    out.push(a);
                }
            }
            if ui.input.keys.iter().any(|k| k.0 == Key::Escape) {
                out.push(Action::Close);
            }
            let _ = t;
        });
        out
    }
}
