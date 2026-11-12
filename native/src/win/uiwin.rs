//! Windows drawn with the ui kit: the procedure only queues events (like the pet window), and the
//! app redraws the window's immediate-mode frame for each one.
use super::{push, Input};
use crate::ui::widgets::{key_from_vk, place_ime, Input as UiInput, Mods, State, Ui};
use crate::ui::{Surface, Theme};
use std::time::Instant;
use windows::core::PCWSTR;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::DwmSetWindowAttribute;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

#[derive(Clone, Copy, Debug)]
pub enum UiEv {
    Move(i32, i32),
    Down(i32, i32, bool),
    Up(i32, i32),
    Wheel(i16),
    Leave,
    Key(u16),
    Char(u16),
    Active(bool),
    Close,
    Paint,
    Size,
    Timer,
}

const MOUSELEAVE: u32 = 0x02A3;
fn lo(l: LPARAM) -> i32 {
    (l.0 & 0xffff) as i16 as i32
}
fn hi(l: LPARAM) -> i32 {
    ((l.0 >> 16) & 0xffff) as i16 as i32
}
pub extern "system" fn ui_proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let ev = |e: UiEv| push(Input::Ui(h.0 as isize, e));
    unsafe {
        match msg {
            WM_MOUSEMOVE => {
                let mut t = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: h, dwHoverTime: 0 };
                let _ = TrackMouseEvent(&mut t);
                ev(UiEv::Move(lo(lp), hi(lp)));
            }
            MOUSELEAVE => ev(UiEv::Leave),
            WM_LBUTTONDOWN | WM_LBUTTONDBLCLK => {
                SetCapture(h);
                ev(UiEv::Down(lo(lp), hi(lp), msg == WM_LBUTTONDBLCLK));
            }
            WM_LBUTTONUP => {
                let _ = ReleaseCapture();
                ev(UiEv::Up(lo(lp), hi(lp)));
            }
            WM_MOUSEWHEEL => ev(UiEv::Wheel(((wp.0 >> 16) & 0xffff) as i16)),
            WM_KEYDOWN | WM_SYSKEYDOWN if msg == WM_KEYDOWN => ev(UiEv::Key(wp.0 as u16)),
            WM_CHAR => ev(UiEv::Char(wp.0 as u16)),
            WM_ACTIVATE => ev(UiEv::Active((wp.0 & 0xffff) != 0)),
            WM_TIMER => ev(UiEv::Timer),
            WM_SIZE => ev(UiEv::Size),
            WM_PAINT => {
                let mut ps = PAINTSTRUCT::default();
                BeginPaint(h, &mut ps);
                let _ = EndPaint(h, &ps);
                ev(UiEv::Paint);
                return LRESULT(0);
            }
            WM_ERASEBKGND => return LRESULT(1),
            WM_CLOSE => {
                ev(UiEv::Close);
                return LRESULT(0);
            }
            WM_GETMINMAXINFO => {
                let mm = &mut *(lp.0 as *mut MINMAXINFO);
                mm.ptMinTrackSize = POINT { x: 760, y: 520 };
            }
            _ => {}
        }
        DefWindowProcW(h, msg, wp, lp)
    }
}

pub struct UiWin {
    pub hwnd: HWND,
    pub layered: bool,
    surface: Option<Surface>,
    pub input: UiInput,
    pub st: State,
    /// Device px per CSS px.
    pub scale: f64,
    /// Device position of the window (layered windows are moved by their own present).
    pub pos: (i32, i32),
    /// CSS size of what is drawn.
    pub size: (f64, f64),
    pub theme: Theme,
    clock: Instant,
    blinking: bool,
}
impl UiWin {
    pub fn create(class: PCWSTR, title: PCWSTR, layered: bool, style: WINDOW_STYLE, ex: WINDOW_EX_STYLE, w: i32, h: i32) -> Option<UiWin> {
        crate::ui::register_class(class, Some(ui_proc));
        unsafe {
            let hinst: HINSTANCE = windows::Win32::System::LibraryLoader::GetModuleHandleW(None).ok()?.into();
            let ex = if layered { ex | WS_EX_LAYERED } else { ex };
            let hwnd = CreateWindowExW(ex, class, title, style, CW_USEDEFAULT, CW_USEDEFAULT, w, h, HWND::default(), HMENU::default(), hinst, None).ok()?;
            if !layered {
                // Windows 11 rounded corners; ignored elsewhere.
                let pref: u32 = 2;
                let _ = DwmSetWindowAttribute(hwnd, windows::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE(33), &pref as *const _ as *const _, 4);
            }
            let dpi = GetDpiForWindow(hwnd);
            Some(UiWin {
                hwnd,
                layered,
                surface: None,
                input: UiInput::default(),
                st: State::default(),
                scale: if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 },
                pos: (0, 0),
                size: (w as f64, h as f64),
                theme: crate::ui::LIGHT,
                clock: Instant::now(),
                blinking: false,
            })
        }
    }
    pub fn refresh_scale(&mut self) {
        let dpi = unsafe { GetDpiForWindow(self.hwnd) };
        if dpi != 0 {
            self.scale = dpi as f64 / 96.0;
        }
    }
    /// Turns a window event into widget input. Returns false for events the caller handles.
    pub fn feed(&mut self, e: UiEv) -> bool {
        let k = self.scale;
        let css = |x: i32, y: i32| (x as f64 / k, y as f64 / k);
        let i = &mut self.input;
        i.time = self.clock.elapsed().as_secs_f64();
        match e {
            UiEv::Move(x, y) => i.mouse = Some(css(x, y)),
            UiEv::Down(x, y, dbl) => {
                i.mouse = Some(css(x, y));
                i.down = true;
                i.pressed = true;
                i.double = dbl;
            }
            UiEv::Up(x, y) => {
                i.mouse = Some(css(x, y));
                i.down = false;
                i.released = true;
            }
            UiEv::Wheel(d) => i.wheel += d as f64,
            UiEv::Leave => {
                if !i.down {
                    i.mouse = None;
                }
            }
            UiEv::Key(vk) => {
                let ctrl = unsafe { GetKeyState(VK_CONTROL.0 as i32) } < 0;
                let shift = unsafe { GetKeyState(VK_SHIFT.0 as i32) } < 0;
                if let Some(key) = key_from_vk(vk, ctrl) {
                    i.keys.push((key, Mods { shift, ctrl }));
                }
            }
            UiEv::Char(c) => i.chars.push(c),
            UiEv::Timer | UiEv::Paint | UiEv::Size => {}
            UiEv::Active(_) | UiEv::Close => return false,
        }
        true
    }
    pub fn now(&self) -> f64 {
        self.clock.elapsed().as_secs_f64()
    }
    /// Draws a frame of `size` CSS px and shows it.
    pub fn render(&mut self, build: impl FnOnce(&mut Ui)) {
        self.draw(build);
        self.present(self.size.1);
    }
    /// Shows the top `h` CSS px of the last frame (layered) or all of it (normal windows).
    pub fn present(&self, h: f64) {
        let Some(s) = &self.surface else { return };
        if self.layered {
            s.present_layered_part(self.hwnd, self.pos.0, self.pos.1, (h * self.scale).round() as usize);
        } else {
            unsafe {
                let hdc = GetDC(self.hwnd);
                s.present_blit(hdc);
                ReleaseDC(self.hwnd, hdc);
            }
        }
    }
    /// Draws a frame without showing it.
    pub fn draw(&mut self, build: impl FnOnce(&mut Ui)) {
        let (dw, dh) = ((self.size.0 * self.scale).round() as usize, (self.size.1 * self.scale).round() as usize);
        if self.surface.as_ref().is_none_or(|s| s.w != dw || s.h != dh) {
            self.surface = Surface::new(dw, dh);
        }
        let Some(s) = &self.surface else { return };
        self.input.time = self.clock.elapsed().as_secs_f64();
        self.st.caret = None;
        self.st.wants_blink = false;
        let (input, st) = (&mut self.input, &mut self.st);
        s.draw(self.scale, self.theme, |p| {
            let mut ui = Ui { p, input, st };
            build(&mut ui);
        });
        if let Some((x, y, h)) = self.st.caret {
            place_ime(self.hwnd, (x * self.scale) as i32, (y * self.scale) as i32, (h * self.scale) as i32);
        }
        // A blinking caret or pulsing dot asks for a redraw every half second.
        if self.st.wants_blink != self.blinking {
            self.blinking = self.st.wants_blink;
            unsafe {
                if self.blinking {
                    SetTimer(self.hwnd, 1, 80, None);
                } else {
                    let _ = KillTimer(self.hwnd, 1);
                }
            }
        }
        self.input.settle();
    }
    pub fn visible(&self) -> bool {
        unsafe { IsWindowVisible(self.hwnd).as_bool() }
    }
    pub fn show(&self, activate: bool) {
        unsafe {
            let _ = ShowWindow(self.hwnd, if activate { SW_SHOW } else { SW_SHOWNOACTIVATE });
            if activate {
                let _ = SetForegroundWindow(self.hwnd);
                let _ = SetFocus(self.hwnd);
            }
        }
    }
    pub fn hide(&mut self) {
        unsafe {
            let _ = ShowWindow(self.hwnd, SW_HIDE);
        }
        self.input = UiInput::default();
        self.st.active = None;
    }
    /// Client size in CSS px (normal windows).
    pub fn client_css(&self) -> (f64, f64) {
        let mut r = RECT::default();
        unsafe {
            let _ = GetClientRect(self.hwnd, &mut r);
        }
        ((r.right - r.left) as f64 / self.scale, (r.bottom - r.top) as f64 / self.scale)
    }
}

impl UiWin {
    /// Writes the top `h` CSS px of the last frame as a PNG (tests and screenshots).
    pub fn save_png(&self, path: &std::path::Path, h: f64) {
        let Some(s) = &self.surface else { return };
        let rows = ((h * self.scale).round() as usize).clamp(1, s.h);
        let mut rgba = Vec::with_capacity(s.w * rows * 4);
        for i in 0..s.w * rows {
            let p = unsafe { *s.bits.add(i) };
            let a = p >> 24;
            let un = |c: u32| if a == 0 { 0 } else { ((c * 255 + a / 2) / a).min(255) as u8 };
            rgba.extend_from_slice(&[un((p >> 16) & 255), un((p >> 8) & 255), un(p & 255), a as u8]);
        }
        if let Ok(f) = std::fs::File::create(path) {
            let mut e = png::Encoder::new(std::io::BufWriter::new(f), s.w as u32, rows as u32);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            let _ = e.write_header().and_then(|mut w| w.write_image_data(&rgba));
        }
    }
}
