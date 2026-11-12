//! The Windows host (desktop/main.cjs): one per-pixel-alpha layered window, the frame loop, docking
//! and dragging the window, the ahoge tow, tray icon, menu, hotkeys and settings.
//!
//! The window procedure only queues input; all work happens in the main loop, so a Win32 call
//! that re-enters the window procedure can never alias the app state. A layered window updated
//! with `UpdateLayeredWindow` lets the system pass clicks through transparent pixels by itself:
//! no mouse hook, nothing to stall.
use crate::dock::{self, Drag, Rect};
use crate::pet::{Effect, Pet, PointerInfo, Settings};
use crate::render::raster::Frame;
use crate::settings;
use crate::util::clamp;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::time::Instant;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::*;
use windows::Win32::UI::HiDpi::*;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::Shell::*;
use windows::Win32::UI::WindowsAndMessaging::*;

const WM_TRAY: u32 = WM_APP + 1;
const HOTKEY_TOGGLE: i32 = 1;
const HOTKEY_RESET: i32 = 2;
const HOTKEY_CHAT: i32 = 3;
const WM_WAKE: u32 = WM_APP + 2;
const POLL: f64 = 0.033;

#[derive(Clone, Copy, Debug)]
enum Input {
    Down(i32, i32),
    Move(i32, i32),
    Up(i32, i32),
    CaptureLost,
    Context,
    Wheel(i16, bool),
    Hotkey(i32),
    Tray(u32),
    Displays,
    Close,
    /// An event for one of the windows drawn with the ui kit (menu, bubble, editor).
    Ui(isize, uiwin::UiEv),
}
thread_local! {
    static INPUT: RefCell<VecDeque<Input>> = const { RefCell::new(VecDeque::new()) };
    static TASKBAR_CREATED: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}
fn push(i: Input) {
    INPUT.with(|q| q.borrow_mut().push_back(i));
}
fn lo(l: LPARAM) -> i32 {
    (l.0 & 0xffff) as i16 as i32
}
fn hi(l: LPARAM) -> i32 {
    ((l.0 >> 16) & 0xffff) as i16 as i32
}

extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_LBUTTONDOWN => push(Input::Down(lo(lp), hi(lp))),
        WM_MOUSEMOVE => push(Input::Move(lo(lp), hi(lp))),
        WM_LBUTTONUP => push(Input::Up(lo(lp), hi(lp))),
        WM_CAPTURECHANGED => push(Input::CaptureLost),
        WM_RBUTTONUP => push(Input::Context),
        WM_MOUSEWHEEL => {
            let ctrl = (wp.0 & 0x0008) != 0; // MK_CONTROL
            push(Input::Wheel(((wp.0 >> 16) & 0xffff) as i16, ctrl));
        }
        WM_HOTKEY => push(Input::Hotkey(wp.0 as i32)),
        WM_TRAY => push(Input::Tray((lp.0 & 0xffff) as u32)),
        WM_DISPLAYCHANGE | WM_DPICHANGED | WM_SETTINGCHANGE => push(Input::Displays),
        WM_CLOSE => {
            push(Input::Close);
            return LRESULT(0);
        }
        WM_DESTROY => unsafe { PostQuitMessage(0) },
        _ if msg == TASKBAR_CREATED.with(|c| c.get()) && msg != 0 => push(Input::Tray(u32::MAX)),
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}

/// One monitor, in screen DIP of the pet's current scale.
#[derive(Clone, Copy, Debug)]
struct Display {
    bounds: Rect,
    work: Rect,
}

struct Surface {
    dc: HDC,
    bmp: HBITMAP,
    old: HGDIOBJ,
    bits: *mut u32,
    w: usize,
    h: usize,
}
impl Surface {
    fn new(w: usize, h: usize) -> Option<Surface> {
        unsafe {
            let screen = GetDC(HWND::default());
            let dc = CreateCompatibleDC(screen);
            ReleaseDC(HWND::default(), screen);
            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w as i32,
                    biHeight: -(h as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits = std::ptr::null_mut();
            let bmp = CreateDIBSection(dc, &bmi, DIB_RGB_COLORS, &mut bits, HANDLE::default(), 0).ok()?;
            let old = SelectObject(dc, bmp);
            Some(Surface { dc, bmp, old, bits: bits as *mut u32, w, h })
        }
    }
}
impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.old);
            let _ = DeleteObject(self.bmp);
            let _ = DeleteDC(self.dc);
        }
    }
}

struct App {
    hwnd: HWND,
    pet: Pet,
    frame: Frame,
    surface: Option<Surface>,
    /// Window bounds in screen DIP, as last set.
    bounds: Rect,
    scale: f64,
    visible: bool,
    drag: Option<Drag>,
    pressed: bool,
    clock: Instant,
    save_at: Option<f64>,
    top_at: f64,
    tray: NOTIFYICONDATAW,
    quit: bool,
    chat: Option<crate::chat::ChatHost>,
    bubble: Option<bubble::Bubble>,
    menu: Option<menu::Menu>,
    bubble_hide_at: Option<f64>,
    typing_sent: f64,
}

mod bubble;
pub mod editor;
mod chat_app;
mod menu;
mod smoke;
mod uiwin;

impl App {
    fn now(&self) -> f64 {
        self.clock.elapsed().as_secs_f64()
    }
    fn displays(&self) -> Vec<Display> {
        unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
            let out = &mut *(data.0 as *mut Vec<(RECT, RECT)>);
            let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if GetMonitorInfoW(m, &mut mi).as_bool() {
                out.push((mi.rcMonitor, mi.rcWork));
            }
            TRUE
        }
        let mut raw: Vec<(RECT, RECT)> = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(HDC::default(), None, Some(each), LPARAM(&mut raw as *mut _ as isize));
        }
        let k = self.scale;
        let r = |r: RECT| Rect::new(r.left as f64 / k, r.top as f64 / k, (r.right - r.left) as f64 / k, (r.bottom - r.top) as f64 / k);
        raw.into_iter().map(|(b, w)| Display { bounds: r(b), work: r(w) }).collect()
    }
    /// The display containing (or nearest to) a DIP point.
    fn display_at(&self, x: f64, y: f64) -> Display {
        let all = self.displays();
        let d2 = |d: &Display| {
            let b = d.bounds;
            let dx = (b.x - x).max(0.0).max(x - (b.x + b.width));
            let dy = (b.y - y).max(0.0).max(y - (b.y + b.height));
            dx * dx + dy * dy
        };
        all.iter().copied().min_by(|a, b| d2(a).total_cmp(&d2(b))).unwrap_or(Display { bounds: Rect::new(0.0, 0.0, 1920.0, 1080.0), work: Rect::new(0.0, 0.0, 1920.0, 1040.0) })
    }
    fn primary(&self) -> Display {
        let p = POINT { x: 0, y: 0 };
        unsafe {
            let m = MonitorFromPoint(p, MONITOR_DEFAULTTOPRIMARY);
            let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            let _ = GetMonitorInfoW(m, &mut mi);
            let k = self.scale;
            let r = |r: RECT| Rect::new(r.left as f64 / k, r.top as f64 / k, (r.right - r.left) as f64 / k, (r.bottom - r.top) as f64 / k);
            Display { bounds: r(mi.rcMonitor), work: r(mi.rcWork) }
        }
    }
    fn home_bounds(&self) -> Rect {
        let d = self.primary();
        let s = &self.pet.settings;
        let cx = dock::home_center_x(d.work);
        if s.docked {
            dock::docked_bounds(d.work, d.bounds, s.size, cx)
        } else {
            dock::free_bounds(d.work, s.size, (cx, d.work.y + d.work.height - 12.0 - s.size / 2.0))
        }
    }
    fn update_scale(&mut self) {
        let dpi = unsafe { GetDpiForWindow(self.hwnd) };
        let k = if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 };
        if (k - self.scale).abs() > 1e-6 {
            // Keep the window where it is on screen; only the DIP numbers change.
            self.bounds = Rect::new(self.bounds.x * self.scale / k, self.bounds.y * self.scale / k, self.bounds.width, self.bounds.height);
            self.scale = k;
        }
    }
    fn apply_bounds(&mut self, b: Rect) {
        self.bounds = b;
        let k = self.scale;
        unsafe {
            let _ = SetWindowPos(
                self.hwnd,
                HWND_TOPMOST,
                (b.x * k).round() as i32,
                (b.y * k).round() as i32,
                (b.width * k).round() as i32,
                (b.height * k).round() as i32,
                SWP_NOACTIVATE,
            );
        }
        self.pet.layout(b.width, b.height, k);
        self.save_at = Some(self.now() + 0.2);
    }
    /// After a size, mode or display change: docked keeps the bottom edge and centre x, free
    /// keeps the centre.
    fn relayout(&mut self, from_docked: bool) {
        self.update_scale();
        let cur = self.bounds;
        let (cx, cy) = (cur.x + cur.width / 2.0, cur.y + cur.height / 2.0);
        let d = self.display_at(cx, cy);
        let s = self.pet.settings;
        let b = if s.docked {
            dock::docked_bounds(d.work, d.bounds, s.size, cx)
        } else {
            dock::free_bounds(d.work, s.size, (cx, if from_docked { d.work.y + d.work.height - 12.0 - s.size / 2.0 } else { cy }))
        };
        self.apply_bounds(b);
        if let Some(drag) = self.drag.as_mut() {
            let active = drag.active;
            *drag = Drag::new(cursor_dip(self.scale), b, s.docked);
            drag.active = active;
        }
    }
    fn set_settings(&mut self, next: Settings) {
        let before = self.pet.settings;
        if next == before {
            return;
        }
        self.pet.apply_settings(next);
        if next.size != before.size || next.docked != before.docked {
            self.relayout(before.docked && !next.docked);
        }
        self.save_at = Some(self.now() + 0.2);
    }
    fn toggle_visible(&mut self) {
        self.drag = None;
        self.visible = !self.visible;
        unsafe {
            let _ = ShowWindow(self.hwnd, if self.visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
        }
        if !self.visible {
            let now = self.now();
            self.pet.blur(now);
        }
    }
    fn reset_position(&mut self) {
        self.drag = None;
        let mut s = self.pet.settings;
        s.docked = true;
        self.pet.apply_settings(s);
        let b = self.home_bounds();
        self.apply_bounds(b);
        if !self.visible {
            self.toggle_visible();
        }
        let now = self.now();
        self.pet.action("reset", now);
    }

    // ---- dragging (main.cjs) ----------------------------------------------------------------
    fn drag_step(&mut self, p: (f64, f64)) {
        let Some(mut drag) = self.drag else { return };
        let s = self.pet.settings;
        let l = dock::layout(s.size, s.docked);
        let next = drag.bounds_for(p, self.bounds, l);
        self.drag = Some(drag);
        if s.docked {
            if drag.active && dock::should_undock(p.1 - drag.point.1, s.size) {
                self.undock(p);
                return;
            }
            let Some(next) = next else { return };
            let d = self.display_at(p.0, p.1);
            let b = dock::docked_bounds(d.work, d.bounds, s.size, next.x + l.width / 2.0);
            if b.x != self.bounds.x || b.y != self.bounds.y {
                self.apply_bounds(b);
            }
        } else if let Some(next) = next {
            self.apply_bounds(next);
        }
    }
    fn undock(&mut self, p: (f64, f64)) {
        let mut s = self.pet.settings;
        s.docked = false;
        self.pet.apply_settings(s);
        let d = self.display_at(p.0, p.1);
        let b = dock::free_bounds(d.work, s.size, (p.0, p.1 - 6.0 - s.size / 2.0));
        self.apply_bounds(b);
        let mut drag = Drag::new(p, b, false);
        drag.active = true;
        self.drag = Some(drag);
    }
    fn end_drag(&mut self) {
        let Some(was) = self.drag.take() else { return };
        let s = self.pet.settings;
        if !was.active || s.docked {
            return;
        }
        let d = self.display_at(self.bounds.x + self.bounds.width / 2.0, self.bounds.y + self.bounds.height / 2.0);
        if dock::should_dock(self.bounds, d.work, Some(s.size)) {
            let mut n = s;
            n.docked = true;
            self.set_settings(n);
        }
    }

    // ---- per-tick work ---------------------------------------------------------------------------
    fn poll_pointer(&mut self) {
        let p = cursor_dip(self.scale);
        if self.drag.is_some() {
            self.drag_step(p);
        }
        let r = self.bounds;
        let s = self.pet.settings;
        let d = self.display_at(r.x + r.width / 2.0, r.y + r.height / 2.0);
        let (mut track, mut wall) = (None, (0.0, 0.0));
        if s.docked {
            let others: Vec<Rect> = self.displays().into_iter().map(|o| o.bounds).filter(|b| *b != d.bounds).collect();
            let (min, max) = dock::dock_range(d.work, d.bounds, s.size);
            track = Some((r.x, min, max));
            wall = dock::wall_info(r, d.bounds, s.size, &others);
        }
        let area = d.work;
        let gy_base = if s.docked { r.height - (s.size * 0.05).round() - s.size * 0.2024 } else { r.height * 0.5 };
        let info = PointerInfo {
            x: p.0 - r.x,
            y: p.1 - r.y,
            sx: p.0,
            sy: p.1,
            gx: clamp((p.0 - r.x - r.width * 0.5) / 200f64.max(area.width * 0.45), -1.0, 1.0),
            gy: clamp((p.1 - r.y - gy_base) / 200f64.max(area.height * 0.45), -1.0, 1.0),
            inner_side: if r.x + r.width * 0.5 < area.x + area.width * 0.5 { 1.0 } else { -1.0 },
            track,
            wall,
        };
        let now = self.now();
        if self.visible {
            self.pet.set_pointer(Some(info), now);
        }
    }
    fn local(&self, x: i32, y: i32) -> (f64, f64, f64, f64) {
        let k = self.scale;
        let (lx, ly) = (x as f64 / k, y as f64 / k);
        (lx, ly, self.bounds.x + lx, self.bounds.y + ly)
    }
    fn handle(&mut self, input: Input) {
        let now = self.now();
        match input {
            Input::Down(x, y) => {
                let (lx, ly, sx, sy) = self.local(x, y);
                let hit = self.frame.alpha(x.max(0) as usize, y.max(0) as usize) > 24;
                if hit && !self.pressed {
                    self.pressed = true;
                    unsafe {
                        SetCapture(self.hwnd);
                    }
                }
                self.pet.press(lx, ly, sx, sy, hit, now);
            }
            Input::Move(x, y) => {
                if self.pressed {
                    let (lx, ly, _, _) = self.local(x, y);
                    let c = cursor_dip(self.scale);
                    self.pet.pointer_move(lx, ly, c.0, c.1);
                    if self.drag.is_some() {
                        self.drag_step(c);
                    }
                }
            }
            Input::Up(x, y) => {
                if self.pressed {
                    self.pressed = false;
                    let (lx, ly, _, _) = self.local(x, y);
                    let c = cursor_dip(self.scale);
                    self.pet.release(Some((lx, ly, c.0, c.1)), now);
                    unsafe {
                        let _ = ReleaseCapture();
                    }
                }
            }
            Input::CaptureLost => {
                if self.pressed {
                    self.pressed = false;
                    self.pet.release(None, now);
                }
            }
            Input::Context => self.pet.context_menu(now),
            Input::Wheel(delta, ctrl) => self.pet.wheel(delta as f64, ctrl, now),
            Input::Hotkey(HOTKEY_TOGGLE) => self.toggle_visible(),
            Input::Hotkey(HOTKEY_RESET) => self.reset_position(),
            Input::Hotkey(HOTKEY_CHAT) => self.toggle_chat(),
            Input::Hotkey(_) => {}
            Input::Tray(m) if m == WM_LBUTTONUP => self.toggle_visible(),
            Input::Tray(m) if m == WM_RBUTTONUP => self.menu(),
            Input::Tray(u32::MAX) => unsafe {
                let _ = Shell_NotifyIconW(NIM_ADD, &self.tray);
            },
            Input::Tray(_) => {}
            Input::Displays => self.relayout(false),
            Input::Close => self.quit = true,
            Input::Ui(h, e) => self.ui_event(h, e),
        }
        for e in self.pet.take_effects() {
            self.effect(e);
        }
    }
    fn effect(&mut self, e: Effect) {
        let s = self.pet.settings;
        match e {
            Effect::Drag(true) => {
                self.drag = Some(Drag::new(cursor_dip(self.scale), self.bounds, s.docked));
            }
            Effect::Drag(false) => self.end_drag(),
            Effect::Tow(x) => {
                if self.drag.is_some() || !s.docked {
                    return;
                }
                let d = self.display_at(self.bounds.x + self.bounds.width / 2.0, self.bounds.y + self.bounds.height / 2.0);
                let l = dock::layout(s.size, true);
                let b = dock::docked_bounds(d.work, d.bounds, s.size, x + l.width / 2.0);
                if b.x != self.bounds.x || b.y != self.bounds.y {
                    self.apply_bounds(b);
                }
            }
            Effect::Menu => self.menu(),
            Effect::Zoom(steps) => {
                let n = steps.trunc().clamp(-10.0, 10.0);
                if n != 0.0 {
                    let mut next = s;
                    next.size = dock::clamp_size(s.size + n * 10.0);
                    self.set_settings(next);
                }
            }
            Effect::Chat => self.toggle_chat(),
        }
    }
    /// The menu card at the cursor (main.cjs showMenuAt / popupPosition).
    fn menu(&mut self) {
        self.drag = None;
        let p = cursor_dip(self.scale);
        let d = self.display_at(p.0, p.1);
        let b = dock::popup_position(p, menu::MENU_W, menu::MENU_H, d.work);
        let scale = self.scale;
        let Some(m) = self.menu.as_mut() else { return };
        m.win.refresh_scale();
        let k = m.win.scale;
        // The card has a 10 px margin for its shadow: the visible corner sits at the cursor.
        m.win.pos = (((b.x - 10.0) * scale).round() as i32, ((b.y - 10.0) * scale).round() as i32);
        let _ = k;
        m.shown_at = self.clock.elapsed().as_secs_f64();
        self.menu_frame();
        if let Some(m) = &self.menu {
            m.win.show(true);
        }
    }
    fn hide_menu(&mut self) {
        if let Some(m) = self.menu.as_mut() {
            m.win.hide();
        }
    }
    fn menu_frame(&mut self) {
        let (s, visible) = (self.pet.settings, self.visible);
        let Some(m) = self.menu.as_mut() else { return };
        let actions = m.frame(s, visible);
        for a in actions {
            let s = self.pet.settings;
            let mut next = s;
            match a {
                menu::Action::Size(v) => next.size = dock::clamp_size(v),
                menu::Action::Follow => next.follow = !s.follow,
                menu::Action::Idle => next.idle = !s.idle,
                menu::Action::Docked => next.docked = !s.docked,
                menu::Action::Chat => {
                    self.hide_menu();
                    self.show_bubble(bubble::Mode::Chat, false);
                    continue;
                }
                menu::Action::Hide => {
                    self.hide_menu();
                    self.toggle_visible();
                    continue;
                }
                menu::Action::Quit => {
                    self.quit = true;
                    continue;
                }
                menu::Action::Close => {
                    self.hide_menu();
                    continue;
                }
            }
            self.set_settings(next);
        }
        // Toggles redraw with their new state.
        if self.menu.as_ref().is_some_and(|m| m.win.visible()) {
            let (s, visible) = (self.pet.settings, self.visible);
            if let Some(m) = self.menu.as_mut() {
                let _ = m.frame(s, visible);
            }
        }
    }
    /// Routes an event to the ui-kit window it belongs to.
    fn ui_event(&mut self, h: isize, e: uiwin::UiEv) {
        let now = self.now();
        if self.menu.as_ref().is_some_and(|m| m.win.hwnd.0 as isize == h) {
            match e {
                uiwin::UiEv::Active(false) => {
                    // A tray click can steal focus right after the menu shows; ignore that once.
                    let m = self.menu.as_ref().unwrap();
                    if m.win.now() - m.shown_at < 0.15 {
                        m.win.show(true);
                    } else {
                        self.hide_menu();
                    }
                }
                uiwin::UiEv::Close => self.hide_menu(),
                e => {
                    if self.menu.as_mut().unwrap().win.feed(e) {
                        self.menu_frame();
                    }
                }
            }
            return;
        }
        if self.bubble.as_ref().is_some_and(|b| b.win.hwnd.0 as isize == h) {
            self.bubble_event(e, now);
        }
    }
    fn render(&mut self, now: f64) {
        self.pet.frame(now, &mut self.frame);
        for e in self.pet.take_effects() {
            self.effect(e);
        }
        let (w, h) = (self.frame.w, self.frame.h);
        // Debugging aid: BLUEFISH_DUMP_FRAME=<file.png> writes one frame after two seconds.
        if now > 2.0 {
            if let Some(path) = std::env::var_os("BLUEFISH_DUMP_FRAME") {
                std::env::remove_var("BLUEFISH_DUMP_FRAME");
                let mut rgba = Vec::with_capacity(w * h * 4);
                for p in &self.frame.px {
                    rgba.extend_from_slice(&[(p >> 16) as u8, (p >> 8) as u8, *p as u8, (p >> 24) as u8]);
                }
                if let Ok(f) = std::fs::File::create(path) {
                    let mut e = png::Encoder::new(std::io::BufWriter::new(f), w as u32, h as u32);
                    e.set_color(png::ColorType::Rgba);
                    e.set_depth(png::BitDepth::Eight);
                    let _ = e.write_header().and_then(|mut wr| wr.write_image_data(&rgba));
                }
            }
        }
        if self.surface.as_ref().is_none_or(|s| s.w != w || s.h != h) {
            self.surface = Surface::new(w, h);
        }
        let Some(surf) = &self.surface else { return };
        unsafe {
            std::ptr::copy_nonoverlapping(self.frame.px.as_ptr(), surf.bits, w * h);
            let k = self.scale;
            let dst = POINT { x: (self.bounds.x * k).round() as i32, y: (self.bounds.y * k).round() as i32 };
            let size = SIZE { cx: w as i32, cy: h as i32 };
            let src = POINT::default();
            let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
            let _ = UpdateLayeredWindow(self.hwnd, HDC::default(), Some(&dst), Some(&size), surf.dc, Some(&src), COLORREF(0), Some(&blend), ULW_ALPHA);
        }
    }
    fn tick(&mut self) -> f64 {
        let now = self.now();
        if let Some(t) = self.save_at {
            if now >= t {
                self.save_at = None;
                settings::save(&self.pet.settings, self.bounds.x, self.bounds.y);
            }
        }
        // Keep the docked pet above the taskbar, which also lives in the topmost band.
        if now >= self.top_at {
            self.top_at = now + 2.0;
            if self.visible && self.pet.settings.docked {
                unsafe {
                    let _ = SetWindowPos(self.hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                }
            }
        }
        if self.visible && self.pet.next_frame_in(now) <= 0.0005 {
            self.render(now);
        }
        if self.visible {
            self.pet.next_frame_in(self.now())
        } else {
            0.25
        }
    }
}

thread_local! {
    /// The smoke test stands in for the cursor it pretends to move.
    static FAKE_CURSOR: std::cell::Cell<Option<(f64, f64)>> = const { std::cell::Cell::new(None) };
}
fn cursor_dip(scale: f64) -> (f64, f64) {
    if let Some(p) = FAKE_CURSOR.with(|c| c.get()) {
        return p;
    }
    let mut p = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut p);
    }
    (p.x as f64 / scale, p.y as f64 / scale)
}
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Runs the pet until she is told to quit.
pub fn run(assets: &std::path::Path) -> Result<(), String> {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        // One pet per data folder (tests run their own copy against a throwaway folder).
        let id = {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            settings::folder().to_string_lossy().to_lowercase().hash(&mut h);
            h.finish()
        };
        let name = wide(&format!("Local\\BluefishNative-{id:016x}"));
        let mutex = CreateMutexW(None, TRUE, PCWSTR(name.as_ptr())).map_err(|e| e.to_string())?;
        if GetLastError() == ERROR_ALREADY_EXISTS {
            return Ok(());
        }
        let _keep = mutex;
        let rig = crate::render::rig::Rig::load(assets)?;
        let renderer = crate::render::Renderer::new(&rig, crate::render::rig::loader(assets, &rig, 1));
        let (s, saved) = settings::load();
        let hinst: HINSTANCE = GetModuleHandleW(None).map_err(|e| e.to_string())?.into();
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(wndproc),
            hInstance: hinst,
            hCursor: LoadCursorW(HINSTANCE::default(), IDC_ARROW).unwrap_or_default(),
            lpszClassName: w!("BluefishPet"),
            ..Default::default()
        };
        RegisterClassExW(&class);
        TASKBAR_CREATED.with(|c| c.set(RegisterWindowMessageW(w!("TaskbarCreated"))));
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
            w!("BluefishPet"),
            w!("蓝色肥鱼"),
            WS_POPUP,
            0,
            0,
            100,
            100,
            HWND::default(),
            HMENU::default(),
            hinst,
            None,
        )
        .map_err(|e| e.to_string())?;
        let icon_path = wide(&assets.join("icon.ico").to_string_lossy());
        let icon = LoadImageW(HINSTANCE::default(), PCWSTR(icon_path.as_ptr()), IMAGE_ICON, 32, 32, LR_LOADFROMFILE).map(|h| HICON(h.0)).unwrap_or_default();
        let mut tray = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: hwnd,
            uID: 1,
            uFlags: NIF_ICON | NIF_MESSAGE | NIF_TIP,
            uCallbackMessage: WM_TRAY,
            hIcon: icon,
            ..Default::default()
        };
        for (i, c) in "蓝色肥鱼".encode_utf16().enumerate() {
            tray.szTip[i] = c;
        }
        let _ = Shell_NotifyIconW(NIM_ADD, &tray);
        let _ = RegisterHotKey(hwnd, HOTKEY_TOGGLE, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_F10.0 as u32);
        let _ = RegisterHotKey(hwnd, HOTKEY_RESET, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_F11.0 as u32);
        let _ = RegisterHotKey(hwnd, HOTKEY_CHAT, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_F9.0 as u32);

        let clock = Instant::now();
        let pet = Pet::new(renderer, s, crate::util::Rand::from_clock(), 0.0);
        let dpi = GetDpiForWindow(hwnd);
        let mut app = App {
            hwnd,
            pet,
            frame: Frame::new(1, 1),
            surface: None,
            bounds: Rect::default(),
            scale: if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 },
            visible: true,
            drag: None,
            pressed: false,
            clock,
            save_at: None,
            top_at: 0.0,
            tray,
            quit: false,
            chat: None,
            bubble: None,
            menu: None,
            bubble_hide_at: None,
            typing_sent: -10.0,
        };
        // Saved position, if it is still on a display; else home.
        let start = match saved {
            Some((x, y)) => {
                let l = dock::layout(s.size, s.docked);
                let c = (x + l.width / 2.0, y + l.height / 2.0);
                let d = app.display_at(c.0, c.1);
                if d.bounds.contains(c.0, c.1) {
                    if s.docked {
                        dock::docked_bounds(d.work, d.bounds, s.size, c.0)
                    } else {
                        dock::free_bounds(d.work, s.size, c)
                    }
                } else {
                    app.home_bounds()
                }
            }
            None => app.home_bounds(),
        };
        app.apply_bounds(start);
        app.save_at = None;
        app.render(app.now());
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);

        // The chat brain, its bubble and its settings window.
        app.bubble = bubble::Bubble::create();
        app.menu = menu::Menu::create();
        let raw = hwnd.0 as isize;
        let wake: std::sync::Arc<dyn Fn() + Send + Sync> = std::sync::Arc::new(move || {
            let _ = PostMessageW(HWND(raw as _), WM_WAKE, WPARAM(0), LPARAM(0));
        });
        let chat = crate::chat::ChatHost::start(settings::folder().join("brain"), std::env::var("BLUEFISH_WEIXIN_BASE").ok(), wake);
        for e in chat.history(6) {
            if let Some(b) = app.bubble.as_mut() {
                b.add_line(bubble::Line { who: if e.kind == "heard" { "me" } else { "her" }, text: e.text, channel: e.channel, settings: false });
            }
        }
        app.chat = Some(chat);

        let mut smoke = smoke::Smoke::from_env();
        let timer = CreateWaitableTimerExW(None, PCWSTR::null(), CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS.0).ok();
        let mut next_poll = 0.0;
        let mut msg = MSG::default();
        'outer: loop {
            while PeekMessageW(&mut msg, HWND::default(), 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_QUIT {
                    break 'outer;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            loop {
                let next = INPUT.with(|q| q.borrow_mut().pop_front());
                let Some(i) = next else { break };
                app.handle(i);
            }
            app.pump_chat();
            if app.quit {
                break;
            }
            if let Some(s) = smoke.as_mut() {
                s.step(&mut app);
            }
            let now = app.now();
            if now >= next_poll {
                next_poll = now + POLL;
                app.poll_pointer();
                app.chat_tick(now);
                if app.bubble_visible() {
                    app.place_bubble();
                }
            }
            let frame_in = app.tick();
            let wait = frame_in.min((next_poll - app.now()).max(0.0));
            if let Some(t) = timer {
                let due = -((wait * 1e7) as i64).max(1);
                let _ = SetWaitableTimer(t, &due, 0, None, None, FALSE);
                MsgWaitForMultipleObjectsEx(Some(&[t]), INFINITE, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
            } else {
                MsgWaitForMultipleObjectsEx(None, (wait * 1000.0) as u32, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
            }
        }
        if let Some(c) = &app.chat {
            c.stop();
        }
        settings::save(&app.pet.settings, app.bounds.x, app.bounds.y);
        let _ = Shell_NotifyIconW(NIM_DELETE, &app.tray);
        let _ = DestroyWindow(hwnd);
        Ok(())
    }
}
