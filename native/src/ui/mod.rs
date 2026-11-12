//! A small drawing kit for the pet's own windows (menu, chat bubble, editor), after the OMNI tokens
//! in tokens.css: Direct2D shapes, DirectWrite text (CJK falls back like the browser did) and the
//! stroke icons. All coordinates are CSS px; the surface scales them to device pixels.
pub mod icons;
pub mod widgets;

use std::cell::RefCell;
use std::collections::HashMap;
use windows::core::{w, Interface, PCWSTR};
use windows::Foundation::Numerics::Matrix3x2;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct2D::Common::*;
use windows::Win32::Graphics::Direct2D::*;
use windows::Win32::Graphics::DirectWrite::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::WindowsAndMessaging::*;

// ---- tokens.css ------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Color(pub u32, pub f32);
impl Color {
    pub const fn hex(v: u32) -> Color {
        Color(v, 1.0)
    }
    pub const fn alpha(self, a: f32) -> Color {
        Color(self.0, a)
    }
    fn d2d(self) -> D2D1_COLOR_F {
        D2D1_COLOR_F { r: ((self.0 >> 16) & 255) as f32 / 255.0, g: ((self.0 >> 8) & 255) as f32 / 255.0, b: (self.0 & 255) as f32 / 255.0, a: self.1 }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Theme {
    pub paper: Color,
    pub card: Color,
    pub ink: Color,
    pub ink2: Color,
    pub muted: Color,
    pub faint: Color,
    pub line: Color,
    pub fill: Color,
    pub fill_soft: Color,
    pub fill_hover: Color,
    pub on_ink: Color,
    pub ink_hover: Color,
    pub ok: Color,
    pub warn: Color,
    pub err: Color,
    pub danger: Color,
    pub focus: Color,
    pub dark: bool,
}
pub const LIGHT: Theme = Theme {
    paper: Color::hex(0xf2f2f2),
    card: Color::hex(0xffffff),
    ink: Color::hex(0x161616),
    ink2: Color::hex(0x555555),
    muted: Color::hex(0x858585),
    faint: Color::hex(0xc2c2c2),
    line: Color::hex(0xdedede),
    fill: Color::hex(0xf3f3f3),
    fill_soft: Color::hex(0xf7f7f7),
    fill_hover: Color::hex(0xe7e7e7),
    on_ink: Color::hex(0xffffff),
    ink_hover: Color::hex(0x333333),
    ok: Color::hex(0x86c99f),
    warn: Color::hex(0xedc463),
    err: Color::hex(0xed8d8d),
    danger: Color::hex(0xc72f3b),
    focus: Color::hex(0x888888),
    dark: false,
};
/// bubble.css's prefers-color-scheme: dark.
pub const DARK: Theme = Theme {
    card: Color::hex(0x2b2b2b),
    ink: Color::hex(0xf2f2f2),
    ink2: Color::hex(0xc8c8c8),
    muted: Color::hex(0x9a9a9a),
    line: Color::hex(0x3d3d3d),
    fill: Color::hex(0x383838),
    fill_soft: Color::hex(0x323232),
    fill_hover: Color::hex(0x444444),
    on_ink: Color::hex(0x161616),
    ink_hover: Color::hex(0xdddddd),
    dark: true,
    ..LIGHT
};
pub const R_XS: f64 = 4.0;
pub const R_CARD: f64 = 7.0;
pub const R_MENU: f64 = 8.0;
pub const R_POP: f64 = 16.0;
pub const R_PILL: f64 = 24.0;

/// Windows' app theme (Settings > Personalization > Colors).
pub fn system_dark() -> bool {
    use windows::Win32::System::Registry::*;
    unsafe {
        let mut v = 1u32;
        let mut size = 4u32;
        let r = RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut v as *mut u32 as *mut _),
            Some(&mut size),
        );
        r.is_ok() && v == 0
    }
}

// ---- shared factories --------------------------------------------------------------------------
pub struct Gfx {
    pub d2d: ID2D1Factory,
    pub dw: IDWriteFactory,
    round: ID2D1StrokeStyle,
    icons: RefCell<HashMap<&'static str, ID2D1PathGeometry>>,
}
thread_local! {
    static GFX: RefCell<Option<std::rc::Rc<Gfx>>> = const { RefCell::new(None) };
}
pub fn gfx() -> std::rc::Rc<Gfx> {
    GFX.with(|g| {
        g.borrow_mut()
            .get_or_insert_with(|| unsafe {
                let d2d: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None).expect("Direct2D");
                let dw: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).expect("DirectWrite");
                let props = D2D1_STROKE_STYLE_PROPERTIES {
                    startCap: D2D1_CAP_STYLE_ROUND,
                    endCap: D2D1_CAP_STYLE_ROUND,
                    dashCap: D2D1_CAP_STYLE_ROUND,
                    lineJoin: D2D1_LINE_JOIN_ROUND,
                    miterLimit: 10.0,
                    dashStyle: D2D1_DASH_STYLE_SOLID,
                    dashOffset: 0.0,
                };
                let round = d2d.CreateStrokeStyle(&props, None).expect("stroke style");
                std::rc::Rc::new(Gfx { d2d, dw, round, icons: RefCell::new(HashMap::new()) })
            })
            .clone()
    })
}
fn pt(x: f64, y: f64) -> D2D_POINT_2F {
    D2D_POINT_2F { x: x as f32, y: y as f32 }
}
fn rect(x: f64, y: f64, w: f64, h: f64) -> D2D_RECT_F {
    D2D_RECT_F { left: x as f32, top: y as f32, right: (x + w) as f32, bottom: (y + h) as f32 }
}
impl Gfx {
    pub fn geometry(&self, figs: &[icons::Figure]) -> Option<ID2D1PathGeometry> {
        unsafe {
            let g = self.d2d.CreatePathGeometry().ok()?;
            let sink = g.Open().ok()?;
            for f in figs {
                sink.BeginFigure(pt(f.start.0, f.start.1), D2D1_FIGURE_BEGIN_FILLED);
                for s in &f.segs {
                    match *s {
                        icons::Seg::Line(x, y) => sink.AddLine(pt(x, y)),
                        icons::Seg::Cubic(c) => sink.AddBezier(&D2D1_BEZIER_SEGMENT { point1: pt(c[0], c[1]), point2: pt(c[2], c[3]), point3: pt(c[4], c[5]) }),
                    }
                }
                sink.EndFigure(if f.closed { D2D1_FIGURE_END_CLOSED } else { D2D1_FIGURE_END_OPEN });
            }
            sink.Close().ok()?;
            Some(g)
        }
    }
    fn icon(&self, name: &'static str) -> Option<ID2D1PathGeometry> {
        if let Some(g) = self.icons.borrow().get(name) {
            return Some(g.clone());
        }
        let g = self.geometry(&icons::icon(name))?;
        self.icons.borrow_mut().insert(name, g.clone());
        Some(g)
    }
}

// ---- text ----------------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Align {
    Left,
    Center,
    Right,
}
#[derive(Clone, Copy, Debug)]
pub struct Font {
    pub size: f64,
    pub weight: i32,
    pub mono: bool,
}
pub const BODY: Font = Font { size: 14.0, weight: 400, mono: false };
pub const SMALL: Font = Font { size: 12.0, weight: 400, mono: false };
pub const LABEL: Font = Font { size: 12.0, weight: 500, mono: false };
pub const NUM: Font = Font { size: 18.0, weight: 500, mono: true };
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
pub fn text_layout(text: &[u16], f: Font, max_w: f64, wrap: bool, align: Align) -> Option<IDWriteTextLayout> {
    let g = gfx();
    unsafe {
        let family = if f.mono { w!("Cascadia Mono") } else { w!("Segoe UI") };
        let fmt = g
            .dw
            .CreateTextFormat(family, None, DWRITE_FONT_WEIGHT(f.weight), DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, f.size as f32, w!("zh-cn"))
            .or_else(|_| g.dw.CreateTextFormat(w!("Consolas"), None, DWRITE_FONT_WEIGHT(f.weight), DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, f.size as f32, w!("zh-cn")))
            .ok()?;
        let _ = fmt.SetWordWrapping(if wrap { DWRITE_WORD_WRAPPING_WRAP } else { DWRITE_WORD_WRAPPING_NO_WRAP });
        let _ = fmt.SetTextAlignment(match align {
            Align::Left => DWRITE_TEXT_ALIGNMENT_LEADING,
            Align::Center => DWRITE_TEXT_ALIGNMENT_CENTER,
            Align::Right => DWRITE_TEXT_ALIGNMENT_TRAILING,
        });
        g.dw.CreateTextLayout(text, &fmt, max_w.max(1.0) as f32, 100000.0).ok()
    }
}
/// (width, height) of laid-out text.
pub fn measure(text: &str, f: Font, max_w: f64, wrap: bool) -> (f64, f64) {
    let Some(l) = text_layout(&wide(text), f, max_w, wrap, Align::Left) else { return (0.0, f.size * 1.5) };
    let mut m = DWRITE_TEXT_METRICS::default();
    unsafe {
        let _ = l.GetMetrics(&mut m);
    }
    (m.widthIncludingTrailingWhitespace as f64, m.height as f64)
}

// ---- painter ------------------------------------------------------------------------------------
pub struct Painter<'a> {
    pub rt: &'a ID2D1RenderTarget,
    pub theme: Theme,
    /// The drawing area in CSS px, and device px per CSS px.
    pub w: f64,
    pub h: f64,
    pub scale: f64,
}
impl Painter<'_> {
    fn brush(&self, c: Color) -> Option<ID2D1SolidColorBrush> {
        unsafe { self.rt.CreateSolidColorBrush(&c.d2d(), None).ok() }
    }
    pub fn clear(&self, c: Option<Color>) {
        unsafe {
            self.rt.Clear(Some(&c.map(|c| c.d2d()).unwrap_or(D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 0.0 })));
        }
    }
    pub fn rrect(&self, x: f64, y: f64, w: f64, h: f64, r: f64, c: Color) {
        let Some(b) = self.brush(c) else { return };
        unsafe {
            self.rt.FillRoundedRectangle(&D2D1_ROUNDED_RECT { rect: rect(x, y, w, h), radiusX: r as f32, radiusY: r as f32 }, &b);
        }
    }
    /// A rounded rectangle filled with a top-to-bottom gradient.
    pub fn vgradient(&self, x: f64, y: f64, w: f64, h: f64, r: f64, top: Color, bottom: Color) {
        unsafe {
            let stops = [D2D1_GRADIENT_STOP { position: 0.0, color: top.d2d() }, D2D1_GRADIENT_STOP { position: 1.0, color: bottom.d2d() }];
            let Ok(coll) = self.rt.CreateGradientStopCollection(&stops, D2D1_GAMMA_2_2, D2D1_EXTEND_MODE_CLAMP) else { return };
            let props = D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES { startPoint: pt(x, y), endPoint: pt(x, y + h) };
            let Ok(b) = self.rt.CreateLinearGradientBrush(&props, None, &coll) else { return };
            self.rt.FillRoundedRectangle(&D2D1_ROUNDED_RECT { rect: rect(x, y, w, h), radiusX: r as f32, radiusY: r as f32 }, &b);
        }
    }
    pub fn rrect_stroke(&self, x: f64, y: f64, w: f64, h: f64, r: f64, c: Color, width: f64) {
        let Some(b) = self.brush(c) else { return };
        let i = width / 2.0;
        unsafe {
            self.rt.DrawRoundedRectangle(&D2D1_ROUNDED_RECT { rect: rect(x + i, y + i, w - width, h - width), radiusX: r as f32, radiusY: r as f32 }, &b, width as f32, None);
        }
    }
    /// A rounded rectangle with its own radius per corner (top-left, top-right, bottom-right, bottom-left).
    pub fn rrect4(&self, x: f64, y: f64, w: f64, h: f64, r: [f64; 4], c: Color) {
        let k = 1.0 - 0.552_284_75;
        let [a, b, cc, d] = r;
        let fig = icons::Figure {
            start: (x + a, y),
            segs: vec![
                icons::Seg::Line(x + w - b, y),
                icons::Seg::Cubic([x + w - b * k, y, x + w, y + b * k, x + w, y + b]),
                icons::Seg::Line(x + w, y + h - cc),
                icons::Seg::Cubic([x + w, y + h - cc * k, x + w - cc * k, y + h, x + w - cc, y + h]),
                icons::Seg::Line(x + d, y + h),
                icons::Seg::Cubic([x + d * k, y + h, x, y + h - d * k, x, y + h - d]),
                icons::Seg::Line(x, y + a),
                icons::Seg::Cubic([x, y + a * k, x + a * k, y, x + a, y]),
            ],
            closed: true,
        };
        self.figure(&[fig], c);
    }
    pub fn figure(&self, figs: &[icons::Figure], c: Color) {
        let (Some(g), Some(b)) = (gfx().geometry(figs), self.brush(c)) else { return };
        unsafe {
            self.rt.FillGeometry(&g, &b, None);
        }
    }
    /// A soft drop shadow under a rounded rectangle: stacked, widening, fading layers.
    pub fn shadow(&self, x: f64, y: f64, w: f64, h: f64, r: f64, dy: f64, blur: f64, spread: f64, alpha: f32) {
        let n = 7;
        for i in 0..n {
            let t = (i as f64 + 0.5) / n as f64;
            let g = spread + blur * (t - 0.5);
            let a = alpha * (1.0 - t as f32).powf(1.6) * 2.2 / n as f32;
            self.rrect(x - g, y - g + dy, w + 2.0 * g, h + 2.0 * g, r + g.max(0.0), Color::hex(0).alpha(a));
        }
    }
    pub fn circle(&self, cx: f64, cy: f64, r: f64, c: Color) {
        let Some(b) = self.brush(c) else { return };
        unsafe {
            self.rt.FillEllipse(&D2D1_ELLIPSE { point: pt(cx, cy), radiusX: r as f32, radiusY: r as f32 }, &b);
        }
    }
    pub fn line(&self, x0: f64, y0: f64, x1: f64, y1: f64, c: Color, width: f64) {
        let Some(b) = self.brush(c) else { return };
        unsafe {
            self.rt.DrawLine(pt(x0, y0), pt(x1, y1), &b, width as f32, &gfx().round);
        }
    }
    /// A 24-unit stroke icon drawn `size` px wide at (x, y): stroke-width 1.6 in icon units.
    pub fn icon(&self, name: &'static str, x: f64, y: f64, size: f64, c: Color) {
        let g = gfx();
        let (Some(geo), Some(b)) = (g.icon(name), self.brush(c)) else { return };
        let k = size / 24.0;
        unsafe {
            let mut old = Matrix3x2::default();
            self.rt.GetTransform(&mut old);
            let m = Matrix3x2 { M11: k as f32, M12: 0.0, M21: 0.0, M22: k as f32, M31: x as f32, M32: y as f32 };
            self.rt.SetTransform(&(m * old));
            self.rt.DrawGeometry(&geo, &b, 1.6, &g.round);
            self.rt.SetTransform(&old);
        }
    }
    pub fn text(&self, s: &str, x: f64, y: f64, w: f64, f: Font, c: Color, align: Align, wrap: bool) -> f64 {
        let Some(l) = text_layout(&wide(s), f, w, wrap, align) else { return 0.0 };
        self.layout(&l, x, y, c);
        let mut m = DWRITE_TEXT_METRICS::default();
        unsafe {
            let _ = l.GetMetrics(&mut m);
        }
        m.height as f64
    }
    pub fn layout(&self, l: &IDWriteTextLayout, x: f64, y: f64, c: Color) {
        let Some(b) = self.brush(c) else { return };
        unsafe {
            self.rt.DrawTextLayout(pt(x, y), l, &b, D2D1_DRAW_TEXT_OPTIONS_NONE);
        }
    }
    pub fn clip(&self, x: f64, y: f64, w: f64, h: f64) {
        unsafe {
            self.rt.PushAxisAlignedClip(&rect(x, y, w, h), D2D1_ANTIALIAS_MODE_ALIASED);
        }
    }
    pub fn unclip(&self) {
        unsafe {
            self.rt.PopAxisAlignedClip();
        }
    }
    /// A premultiplied BGRA image drawn into a CSS rect.
    pub fn image(&self, px: &[u32], w: usize, h: usize, x: f64, y: f64, dw: f64, dh: f64, smooth: bool) {
        unsafe {
            let props = D2D1_BITMAP_PROPERTIES {
                pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
                dpiX: 96.0,
                dpiY: 96.0,
            };
            let Ok(b) = self.rt.CreateBitmap(D2D_SIZE_U { width: w as u32, height: h as u32 }, Some(px.as_ptr() as *const _), (w * 4) as u32, &props) else { return };
            self.rt.DrawBitmap(
                &b,
                Some(&rect(x, y, dw, dh)),
                1.0,
                if smooth { D2D1_BITMAP_INTERPOLATION_MODE_LINEAR } else { D2D1_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR },
                None,
            );
        }
    }
}

// ---- surfaces ------------------------------------------------------------------------------------
/// A device-px DIB with a Direct2D target bound to it. A layered window shows it with
/// UpdateLayeredWindow (per-pixel alpha); a normal window blits it.
pub struct Surface {
    dc: HDC,
    bmp: HBITMAP,
    old: HGDIOBJ,
    pub bits: *mut u32,
    pub w: usize,
    pub h: usize,
    rt: ID2D1DCRenderTarget,
}
impl Surface {
    pub fn new(w: usize, h: usize) -> Option<Surface> {
        let (w, h) = (w.max(1), h.max(1));
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
            let props = D2D1_RENDER_TARGET_PROPERTIES {
                r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
                pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
                dpiX: 96.0,
                dpiY: 96.0,
                usage: D2D1_RENDER_TARGET_USAGE_GDI_COMPATIBLE,
                minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
            };
            let rt = gfx().d2d.CreateDCRenderTarget(&props).ok()?;
            let r = RECT { left: 0, top: 0, right: w as i32, bottom: h as i32 };
            rt.BindDC(dc, &r).ok()?;
            Some(Surface { dc, bmp, old, bits: bits as *mut u32, w, h, rt })
        }
    }
    /// Draws one frame at `scale` (CSS px -> device px).
    pub fn draw(&self, scale: f64, theme: Theme, f: impl FnOnce(&Painter)) {
        unsafe {
            self.rt.BeginDraw();
            self.rt.SetTransform(&Matrix3x2 { M11: scale as f32, M12: 0.0, M21: 0.0, M22: scale as f32, M31: 0.0, M32: 0.0 });
            self.rt.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
            let rt: ID2D1RenderTarget = self.rt.cast().unwrap();
            let p = Painter { rt: &rt, theme, w: self.w as f64 / scale, h: self.h as f64 / scale, scale };
            f(&p);
            let _ = self.rt.EndDraw(None, None);
        }
    }
    /// Shows the surface as a per-pixel-alpha layered window at device position (x, y).
    pub fn present_layered(&self, hwnd: HWND, x: i32, y: i32) {
        self.present_layered_part(hwnd, x, y, self.h);
    }
    /// Shows only the top `h` device rows (a surface drawn taller than its content).
    pub fn present_layered_part(&self, hwnd: HWND, x: i32, y: i32, h: usize) {
        unsafe {
            let dst = POINT { x, y };
            let size = SIZE { cx: self.w as i32, cy: h.clamp(1, self.h) as i32 };
            let src = POINT::default();
            let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
            let _ = UpdateLayeredWindow(hwnd, HDC::default(), Some(&dst), Some(&size), self.dc, Some(&src), COLORREF(0), Some(&blend), ULW_ALPHA);
        }
    }
    pub fn present_blit(&self, hdc: HDC) {
        unsafe {
            let _ = BitBlt(hdc, 0, 0, self.w as i32, self.h as i32, self.dc, 0, 0, SRCCOPY);
        }
    }
    /// The alpha at a device pixel (hit testing a layered window's own shapes).
    pub fn alpha(&self, x: i32, y: i32) -> u8 {
        if x < 0 || y < 0 || x as usize >= self.w || y as usize >= self.h {
            return 0;
        }
        unsafe { (*self.bits.add(y as usize * self.w + x as usize) >> 24) as u8 }
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

/// Registers a window class whose procedure is `proc_`, once.
pub fn register_class(name: PCWSTR, proc_: WNDPROC) {
    unsafe {
        let hinst: HINSTANCE = windows::Win32::System::LibraryLoader::GetModuleHandleW(None).map(|h| h.into()).unwrap_or_default();
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_DBLCLKS,
            lpfnWndProc: proc_,
            hInstance: hinst,
            hCursor: LoadCursorW(HINSTANCE::default(), IDC_ARROW).unwrap_or_default(),
            lpszClassName: name,
            ..Default::default()
        };
        RegisterClassExW(&class);
    }
}
