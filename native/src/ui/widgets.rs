//! Immediate-mode widgets in the tokens.css style: icon buttons (44 px hit, 32 px circle), pills,
//! the plain rect buttons of the editor, the hairline range, the switch, the status dot, an inline
//! select list, and a text field (single or multi-line) with selection, clipboard and IME caret.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    Left,
    Right,
    Up,
    Down,
    Home,
    End,
    Back,
    Delete,
    Enter,
    Escape,
    Tab,
    SelectAll,
    Copy,
    Paste,
    Cut,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mods {
    pub shift: bool,
    pub ctrl: bool,
}
/// One event's worth of input for a frame.
#[derive(Clone, Debug, Default)]
pub struct Input {
    pub mouse: Option<(f64, f64)>,
    pub down: bool,
    pub pressed: bool,
    pub released: bool,
    pub double: bool,
    pub wheel: f64,
    pub keys: Vec<(Key, Mods)>,
    pub chars: Vec<u16>,
    pub time: f64,
}
impl Input {
    /// Clears the edges after a frame has seen them.
    pub fn settle(&mut self) {
        self.pressed = false;
        self.released = false;
        self.double = false;
        self.wheel = 0.0;
        self.keys.clear();
        self.chars.clear();
    }
}
/// Widget state that outlives a frame.
#[derive(Clone, Debug, Default)]
pub struct State {
    pub active: Option<u64>,
    pub focus: Option<u64>,
    /// Where the focused text caret is (CSS px: x, y, height), for the IME windows.
    pub caret: Option<(f64, f64, f64)>,
    pub wants_blink: bool,
    /// While set, only this rect (x, y, w, h) takes the mouse: a scrolled region.
    pub clip: Option<(f64, f64, f64, f64)>,
}

pub struct Ui<'a, 'p> {
    pub p: &'a Painter<'p>,
    pub input: &'a mut Input,
    pub st: &'a mut State,
}
impl Ui<'_, '_> {
    pub fn t(&self) -> Theme {
        self.p.theme
    }
    pub fn p_size(&self) -> (f64, f64) {
        (self.p.w, self.p.h)
    }
    pub fn p_scale(&self) -> f64 {
        self.p.scale
    }
    pub fn hover(&self, x: f64, y: f64, w: f64, h: f64) -> bool {
        let inside = |(mx, my): (f64, f64), (x, y, w, h): (f64, f64, f64, f64)| mx >= x && mx < x + w && my >= y && my < y + h;
        self.input.mouse.is_some_and(|m| inside(m, (x, y, w, h)) && self.st.clip.is_none_or(|c| inside(m, c)))
    }
    /// Press-and-release on the same area. Returns (hovered, clicked).
    pub fn area(&mut self, id: u64, x: f64, y: f64, w: f64, h: f64) -> (bool, bool) {
        let hov = self.hover(x, y, w, h);
        if hov && self.input.pressed {
            self.st.active = Some(id);
        }
        let mut clicked = false;
        if self.input.released && self.st.active == Some(id) {
            clicked = hov;
            self.st.active = None;
        }
        (hov, clicked)
    }
    /// .icon-btn: 44 px hit area, 32 px circle, 18 px glyph; pressed = ink circle.
    pub fn icon_button(&mut self, id: u64, x: f64, y: f64, icon: &'static str, pressed: bool, danger: bool) -> bool {
        self.icon_button_sized(id, x, y, 44.0, icon, pressed, danger)
    }
    pub fn icon_button_sized(&mut self, id: u64, x: f64, y: f64, size: f64, icon: &'static str, pressed: bool, danger: bool) -> bool {
        let t = self.t();
        let (hov, clicked) = self.area(id, x, y, size, size);
        let (cx, cy, r) = (x + size / 2.0, y + size / 2.0, (size - 12.0) / 2.0);
        if pressed {
            self.p.circle(cx, cy, r, if hov { t.ink_hover } else { t.ink });
        } else if hov {
            self.p.circle(cx, cy, r, t.fill);
        }
        let c = if pressed { t.on_ink } else if danger { t.danger } else { t.ink };
        self.p.icon(icon, cx - 9.0, cy - 9.0, 18.0, c);
        clicked
    }
    /// .pill: rounded, card by default, ink when primary or pressed.
    pub fn pill(&mut self, id: u64, x: f64, y: f64, w: f64, h: f64, label: &str, icon: Option<&'static str>, primary: bool, base: Color) -> bool {
        let t = self.t();
        let (hov, clicked) = self.area(id, x, y, w, h);
        let bg = if primary {
            if hov {
                t.ink_hover
            } else {
                t.ink
            }
        } else if hov {
            t.fill_hover
        } else {
            base
        };
        self.p.rrect(x, y, w, h, (h / 2.0).min(R_PILL), bg);
        let fg = if primary { t.on_ink } else { t.ink };
        match icon {
            Some(i) => self.p.icon(i, x + w / 2.0 - 9.0, y + h / 2.0 - 9.0, 18.0, fg),
            None => {
                let (_, th) = measure(label, LABEL, w, false);
                self.p.text(label, x, y + (h - th) / 2.0, w, LABEL, fg, Align::Center, false);
            }
        }
        clicked
    }
    /// .settings .pill: a pill with a hairline border.
    pub fn outline_pill(&mut self, id: u64, x: f64, y: f64, w: f64, h: f64, label: &str, primary: bool) -> bool {
        let t = self.t();
        let c = self.pill(id, x, y, w, h, label, None, primary, t.card);
        if !primary {
            self.p.rrect_stroke(x, y, w, h, h / 2.0, t.line, 1.0);
        }
        c
    }
    /// The editor's .preview-button: r-xs, fill, ink when pressed.
    pub fn rect_button(&mut self, id: u64, x: f64, y: f64, w: f64, h: f64, label: &str, pressed: bool) -> bool {
        let t = self.t();
        let (hov, clicked) = self.area(id, x, y, w, h);
        let bg = if pressed { t.ink } else if hov { t.fill_hover } else { t.fill };
        self.p.rrect(x, y, w, h, R_XS, bg);
        let f = Font { size: 14.0, weight: 500, mono: false };
        let (_, th) = measure(label, f, w - 8.0, false);
        self.p.text(label, x + 4.0, y + (h - th) / 2.0, w - 8.0, f, if pressed { t.paper } else { t.ink }, Align::Center, false);
        clicked
    }
    /// input[type=range].range: a 2 px line, ink up to the value, a 14 px ink thumb.
    pub fn slider(&mut self, id: u64, x: f64, y: f64, w: f64, value: f64, min: f64, max: f64, step: f64) -> Option<f64> {
        let t = self.t();
        let h = 24.0;
        let hov = self.hover(x - 7.0, y, w + 14.0, h);
        if hov && self.input.pressed {
            self.st.active = Some(id);
        }
        let mut out = None;
        if self.st.active == Some(id) {
            if let Some((mx, _)) = self.input.mouse {
                let u = ((mx - x) / w).clamp(0.0, 1.0);
                let mut v = min + u * (max - min);
                if step > 0.0 {
                    v = (v / step).round() * step;
                }
                let v = v.clamp(min, max);
                if (v - value).abs() > 1e-9 {
                    out = Some(v);
                }
            }
            if self.input.released || !self.input.down {
                self.st.active = None;
            }
        }
        let v = out.unwrap_or(value);
        let u = ((v - min) / (max - min)).clamp(0.0, 1.0);
        let cy = y + h / 2.0;
        self.p.rrect(x, cy - 1.0, w, 2.0, 1.0, t.line);
        self.p.rrect(x, cy - 1.0, w * u, 2.0, 1.0, t.ink);
        if self.st.active == Some(id) {
            self.p.circle(x + w * u, cy, 11.0, t.ink.alpha(0.13));
        }
        self.p.circle(x + w * u, cy, 7.0, t.ink);
        out
    }
    /// input[type=checkbox].switch: 48×28, white knob.
    pub fn switch(&mut self, id: u64, x: f64, y: f64, on: bool) -> bool {
        let (_, clicked) = self.area(id, x, y, 48.0, 28.0);
        self.p.rrect(x, y, 48.0, 28.0, 14.0, if on { Color::hex(0x202020) } else { Color::hex(0xcccccc) });
        self.p.circle(x + if on { 34.0 } else { 14.0 }, y + 14.0, 11.0, Color::hex(0xffffff));
        clicked
    }
    /// .dot: 8 px; working pulses.
    pub fn dot(&mut self, cx: f64, cy: f64, state: &str) {
        let t = self.t();
        let (c, a) = match state {
            "working" => (t.warn, 0.3 + 0.7 * (0.5 + 0.5 * (self.input.time * std::f64::consts::TAU / 0.9).cos()) as f32),
            "error" => (t.err, 1.0),
            _ => (t.ok, 1.0),
        };
        self.p.circle(cx, cy, 4.0, c.alpha(a));
        if state == "working" {
            self.st.wants_blink = true;
        }
    }
    /// The editor's select: a fill box with the value and a chevron. Returns whether it was clicked.
    pub fn select_box(&mut self, id: u64, x: f64, y: f64, w: f64, h: f64, value: &str, open: bool, radius: f64) -> bool {
        let t = self.t();
        let (hov, clicked) = self.area(id, x, y, w, h);
        self.p.rrect(x, y, w, h, radius, if hov || open { t.fill_hover } else { t.fill });
        let (_, th) = measure(value, LABEL, w - 40.0, false);
        self.p.text(value, x + 10.0, y + (h - th) / 2.0, w - 40.0, LABEL, t.ink, Align::Left, false);
        self.p.icon("chevron", x + w - 26.0, y + h / 2.0 - 8.0, 16.0, t.ink2);
        clicked
    }
    /// Rows of an open select list; returns the picked index.
    pub fn select_list(&mut self, id: u64, x: f64, y: f64, w: f64, items: &[String], current: &str, row: f64) -> Option<usize> {
        let t = self.t();
        let h = row * items.len() as f64 + 8.0;
        self.p.shadow(x, y, w, h, R_MENU, 4.0, 14.0, -2.0, 0.16);
        self.p.rrect(x, y, w, h, R_MENU, t.card);
        let mut picked = None;
        for (i, it) in items.iter().enumerate() {
            let ry = y + 4.0 + row * i as f64;
            let (hov, clicked) = self.area(id + 1 + i as u64, x + 4.0, ry, w - 8.0, row);
            if hov || it == current {
                self.p.rrect(x + 4.0, ry, w - 8.0, row, R_XS, if hov { t.fill_hover } else { t.fill });
            }
            let (_, th) = measure(it, LABEL, w - 24.0, false);
            self.p.text(it, x + 12.0, ry + (row - th) / 2.0, w - 24.0, LABEL, t.ink, Align::Left, false);
            if clicked {
                picked = Some(i);
            }
        }
        picked
    }

    /// A text field. Draws only the text, selection and caret: the caller draws the box.
    /// Returns what happened (submitted with Enter on a one-line field, text changed).
    pub fn text_edit(&mut self, id: u64, x: f64, y: f64, w: f64, h: f64, e: &mut TextEdit, f: Font, color: Color) -> TextEvent {
        let t = self.t();
        let mut ev = TextEvent::default();
        let hov = self.hover(x, y, w, h);
        let display: Vec<u16> = if e.password { std::iter::repeat_n('•' as u16, e.text.len()).collect() } else { e.text.clone() };
        let layout = text_layout(&display, f, if e.multiline { w } else { 100000.0 }, e.multiline, Align::Left);
        let Some(l) = layout else { return ev };
        let line_h = f.size * 1.45;
        let top_pad = if e.multiline { 0.0 } else { (h - line_h) / 2.0 };
        let origin = |e: &TextEdit| (x - if e.multiline { 0.0 } else { e.scroll }, y + top_pad - if e.multiline { e.scroll } else { 0.0 });
        let hit = |e: &TextEdit, mx: f64, my: f64| -> usize {
            let (ox, oy) = origin(e);
            let mut trailing = BOOL(0);
            let mut inside = BOOL(0);
            let mut m = DWRITE_HIT_TEST_METRICS::default();
            unsafe {
                let _ = l.HitTestPoint((mx - ox) as f32, (my - oy) as f32, &mut trailing, &mut inside, &mut m);
            }
            (m.textPosition + if trailing.as_bool() { m.length } else { 0 }) as usize
        };
        let caret_xy = |pos: usize| -> (f64, f64) {
            let (mut cx, mut cy) = (0f32, 0f32);
            let mut m = DWRITE_HIT_TEST_METRICS::default();
            unsafe {
                let _ = l.HitTestTextPosition(pos as u32, false, &mut cx, &mut cy, &mut m);
            }
            (cx as f64, cy as f64)
        };
        // Mouse: focus, place the caret, drag to select, double-click to select all.
        if hov && self.input.pressed {
            self.st.focus = Some(id);
            self.st.active = Some(id);
            if let Some((mx, my)) = self.input.mouse {
                let p = hit(e, mx, my);
                e.caret = p;
                if !self.input.keys.iter().any(|k| k.1.shift) {
                    e.anchor = p;
                }
            }
            if self.input.double {
                e.anchor = 0;
                e.caret = e.text.len();
            }
            e.blink = self.input.time;
        } else if self.input.pressed && self.st.focus == Some(id) && !hov {
            self.st.focus = None;
        }
        if self.st.active == Some(id) {
            if let (Some((mx, my)), true) = (self.input.mouse, self.input.down) {
                e.caret = hit(e, mx, my);
            }
            if self.input.released {
                self.st.active = None;
            }
        }
        let focused = self.st.focus == Some(id);
        if focused {
            let keys = std::mem::take(&mut self.input.keys);
            for (k, m) in &keys {
                let before = e.text.clone();
                match k {
                    Key::Left => e.move_to(if !m.shift && e.has_sel() { e.sel().0 } else { e.caret.saturating_sub(1) }, m.shift),
                    Key::Right => e.move_to(if !m.shift && e.has_sel() { e.sel().1 } else { (e.caret + 1).min(e.text.len()) }, m.shift),
                    Key::Home => e.move_to(if e.multiline { e.line_start() } else { 0 }, m.shift),
                    Key::End => e.move_to(if e.multiline { e.line_end() } else { e.text.len() }, m.shift),
                    Key::Up | Key::Down if e.multiline => {
                        let (cx, cy) = caret_xy(e.caret);
                        let (ox, oy) = origin(e);
                        let ny = cy + if *k == Key::Up { -line_h * 0.5 } else { line_h * 1.5 };
                        let p = hit(e, ox + cx, oy + ny);
                        e.move_to(p, m.shift);
                    }
                    Key::Back => {
                        if e.has_sel() {
                            e.delete_sel();
                        } else if e.caret > 0 {
                            e.text.remove(e.caret - 1);
                            e.caret -= 1;
                            e.anchor = e.caret;
                        }
                    }
                    Key::Delete => {
                        if e.has_sel() {
                            e.delete_sel();
                        } else if e.caret < e.text.len() {
                            e.text.remove(e.caret);
                        }
                    }
                    Key::Enter => {
                        if e.multiline {
                            e.insert(&['\n' as u16]);
                        } else {
                            ev.submitted = true;
                        }
                    }
                    Key::SelectAll => {
                        e.anchor = 0;
                        e.caret = e.text.len();
                    }
                    Key::Copy | Key::Cut if e.has_sel() && !e.password => {
                        let (a, b) = e.sel();
                        clipboard_set(&e.text[a..b]);
                        if *k == Key::Cut {
                            e.delete_sel();
                        }
                    }
                    Key::Paste => {
                        if let Some(mut s) = clipboard_get() {
                            if !e.multiline {
                                s.retain(|c| *c != '\n' as u16 && *c != '\r' as u16);
                            } else {
                                s.retain(|c| *c != '\r' as u16);
                            }
                            e.insert(&s);
                        }
                    }
                    Key::Escape | Key::Tab => self.input.keys.push((*k, *m)),
                    _ => {}
                }
                if e.text != before {
                    ev.changed = true;
                }
                e.blink = self.input.time;
            }
            let chars: Vec<u16> = std::mem::take(&mut self.input.chars).into_iter().filter(|c| *c >= 0x20 && *c != 0x7f).collect();
            if !chars.is_empty() {
                e.insert(&chars);
                ev.changed = true;
                e.blink = self.input.time;
            }
            if e.text.len() > e.max {
                e.text.truncate(e.max);
                e.caret = e.caret.min(e.max);
                e.anchor = e.anchor.min(e.max);
            }
        }
        // Re-lay-out if the text changed this frame.
        let display: Vec<u16> = if e.password { std::iter::repeat_n('•' as u16, e.text.len()).collect() } else { e.text.clone() };
        let Some(l) = text_layout(&display, f, if e.multiline { w } else { 100000.0 }, e.multiline, Align::Left) else { return ev };
        let (mut cx, mut cy) = (0f32, 0f32);
        let mut cm = DWRITE_HIT_TEST_METRICS::default();
        unsafe {
            let _ = l.HitTestTextPosition(e.caret.min(e.text.len()) as u32, false, &mut cx, &mut cy, &mut cm);
        }
        let (cx, cy) = (cx as f64, cy as f64);
        // Keep the caret in view.
        if e.multiline {
            if cy - e.scroll < 0.0 {
                e.scroll = cy;
            } else if cy + line_h - e.scroll > h {
                e.scroll = cy + line_h - h;
            }
            let mut m = DWRITE_TEXT_METRICS::default();
            unsafe {
                let _ = l.GetMetrics(&mut m);
            }
            e.scroll = e.scroll.clamp(0.0, (m.height as f64 - h).max(0.0));
            if hov && self.input.wheel != 0.0 {
                e.scroll = (e.scroll - self.input.wheel * 0.4).clamp(0.0, (m.height as f64 - h).max(0.0));
                self.input.wheel = 0.0;
            }
        } else {
            if cx - e.scroll > w - 2.0 {
                e.scroll = cx - w + 2.0;
            } else if cx - e.scroll < 0.0 {
                e.scroll = cx;
            }
            e.scroll = e.scroll.max(0.0);
        }
        let (ox, oy) = (x - if e.multiline { 0.0 } else { e.scroll }, y + top_pad - if e.multiline { e.scroll } else { 0.0 });
        self.p.clip(x - 1.0, y, w + 2.0, h);
        if e.text.is_empty() && !e.placeholder.is_empty() {
            self.p.text(&e.placeholder, x, y + top_pad, w, f, t.muted, Align::Left, e.multiline);
        }
        if focused && e.has_sel() {
            let (a, b) = e.sel();
            let mut n = 0u32;
            unsafe {
                let _ = l.HitTestTextRange(a as u32, (b - a) as u32, 0.0, 0.0, None, &mut n);
                let mut buf = vec![DWRITE_HIT_TEST_METRICS::default(); n as usize];
                if l.HitTestTextRange(a as u32, (b - a) as u32, 0.0, 0.0, Some(&mut buf), &mut n).is_ok() {
                    for m in &buf[..n as usize] {
                        self.p.rrect(ox + m.left as f64, oy + m.top as f64, m.width as f64, m.height as f64, 2.0, t.focus.alpha(0.35));
                    }
                }
            }
        }
        self.p.layout(&l, ox, oy, color);
        if focused {
            let on = ((self.input.time - e.blink) / 0.53).floor() as i64 % 2 == 0;
            if on {
                self.p.line(ox + cx + 0.5, oy + cy + 1.0, ox + cx + 0.5, oy + cy + cm.height as f64 - 1.0, t.ink, 1.2);
            }
            self.st.caret = Some((ox + cx, oy + cy, cm.height as f64));
            self.st.wants_blink = true;
        }
        self.p.unclip();
        ev
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct TextEvent {
    pub submitted: bool,
    pub changed: bool,
}

#[derive(Clone, Debug, Default)]
pub struct TextEdit {
    pub text: Vec<u16>,
    pub caret: usize,
    pub anchor: usize,
    pub scroll: f64,
    pub multiline: bool,
    pub password: bool,
    pub placeholder: String,
    pub max: usize,
    blink: f64,
}
impl TextEdit {
    pub fn new(placeholder: &str, max: usize) -> TextEdit {
        TextEdit { placeholder: placeholder.into(), max, ..TextEdit::default() }
    }
    pub fn value(&self) -> String {
        String::from_utf16_lossy(&self.text)
    }
    pub fn set(&mut self, s: &str) {
        self.text = s.encode_utf16().collect();
        self.caret = self.text.len();
        self.anchor = self.caret;
        self.scroll = 0.0;
    }
    fn has_sel(&self) -> bool {
        self.caret != self.anchor
    }
    fn sel(&self) -> (usize, usize) {
        (self.caret.min(self.anchor), self.caret.max(self.anchor))
    }
    fn move_to(&mut self, p: usize, extend: bool) {
        self.caret = p.min(self.text.len());
        if !extend {
            self.anchor = self.caret;
        }
    }
    fn delete_sel(&mut self) {
        let (a, b) = self.sel();
        self.text.drain(a..b);
        self.caret = a;
        self.anchor = a;
    }
    fn insert(&mut self, s: &[u16]) {
        if self.has_sel() {
            self.delete_sel();
        }
        let room = self.max.saturating_sub(self.text.len());
        let s = &s[..s.len().min(room)];
        self.text.splice(self.caret..self.caret, s.iter().copied());
        self.caret += s.len();
        self.anchor = self.caret;
    }
    fn line_start(&self) -> usize {
        self.text[..self.caret].iter().rposition(|c| *c == '\n' as u16).map_or(0, |i| i + 1)
    }
    fn line_end(&self) -> usize {
        self.text[self.caret..].iter().position(|c| *c == '\n' as u16).map_or(self.text.len(), |i| self.caret + i)
    }
}

fn clipboard_set(s: &[u16]) {
    use windows::Win32::System::DataExchange::*;
    use windows::Win32::System::Memory::*;
    unsafe {
        if OpenClipboard(HWND::default()).is_err() {
            return;
        }
        let _ = EmptyClipboard();
        let bytes = (s.len() + 1) * 2;
        if let Ok(h) = GlobalAlloc(GMEM_MOVEABLE, bytes) {
            let p = GlobalLock(h) as *mut u16;
            if !p.is_null() {
                std::ptr::copy_nonoverlapping(s.as_ptr(), p, s.len());
                *p.add(s.len()) = 0;
                let _ = GlobalUnlock(h);
                let _ = SetClipboardData(13 /* CF_UNICODETEXT */, HANDLE(h.0));
            }
        }
        let _ = CloseClipboard();
    }
}
fn clipboard_get() -> Option<Vec<u16>> {
    use windows::Win32::System::DataExchange::*;
    use windows::Win32::System::Memory::*;
    unsafe {
        OpenClipboard(HWND::default()).ok()?;
        let r = (|| {
            let h = GetClipboardData(13).ok()?;
            let p = GlobalLock(HGLOBAL(h.0)) as *const u16;
            if p.is_null() {
                return None;
            }
            let mut n = 0;
            while *p.add(n) != 0 {
                n += 1;
            }
            let v = std::slice::from_raw_parts(p, n).to_vec();
            let _ = GlobalUnlock(HGLOBAL(h.0));
            Some(v)
        })();
        let _ = CloseClipboard();
        r
    }
}

/// Maps a WM_KEYDOWN virtual key to a widget key.
pub fn key_from_vk(vk: u16, ctrl: bool) -> Option<Key> {
    Some(match (vk, ctrl) {
        (0x25, _) => Key::Left,
        (0x27, _) => Key::Right,
        (0x26, _) => Key::Up,
        (0x28, _) => Key::Down,
        (0x24, _) => Key::Home,
        (0x23, _) => Key::End,
        (0x08, _) => Key::Back,
        (0x2E, _) => Key::Delete,
        (0x0D, _) => Key::Enter,
        (0x1B, _) => Key::Escape,
        (0x09, _) => Key::Tab,
        (0x41, true) => Key::SelectAll,
        (0x43, true) => Key::Copy,
        (0x56, true) => Key::Paste,
        (0x58, true) => Key::Cut,
        _ => return None,
    })
}

/// Moves the IME composition and candidate windows to the caret (device px in the window).
pub fn place_ime(hwnd: HWND, x: i32, y: i32, h: i32) {
    use windows::Win32::UI::Input::Ime::*;
    unsafe {
        let himc = ImmGetContext(hwnd);
        if himc.is_invalid() {
            return;
        }
        let cf = COMPOSITIONFORM { dwStyle: CFS_POINT, ptCurrentPos: POINT { x, y }, rcArea: RECT::default() };
        let _ = ImmSetCompositionWindow(himc, &cf);
        let cand = CANDIDATEFORM { dwIndex: 0, dwStyle: CFS_EXCLUDE, ptCurrentPos: POINT { x, y: y + h }, rcArea: RECT { left: x, top: y, right: x + 1, bottom: y + h } };
        let _ = ImmSetCandidateWindow(himc, &cand);
        let _ = ImmReleaseContext(hwnd, himc);
    }
}
