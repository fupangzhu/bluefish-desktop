//! index.html / style.css / app.mjs: the animation editor (`bluefish --editor`). A stage with her on
//! the OMNI gradient, and a rail of cards: size, the deterministic previews with their transport,
//! the head axes, gestures, modes, and the advanced tools (single layer, master compare, cues).
use super::uiwin::{UiEv, UiWin};
use super::Input;
use crate::hands::{self, HandDraw, Skin};
use crate::motion::attention::{head_contact, AttentionInput};
use crate::motion::cue::{from_promptsoul_segment, validate_cue};
use crate::motion::preview::{Preview, PREVIEWS, TOW_GRIP};
use crate::motion::touch::{Part, Point, TouchInput};
use crate::motion::Motion;
use crate::render::raster::{Frame, Target};
use crate::render::rig::{loader, Rig};
use crate::render::{Rect, Renderer};
use crate::ui::widgets::Ui;
use crate::ui::*;
use crate::util::{clamp, Rand};
use std::path::{Path, PathBuf};
use std::time::Instant;

const RAIL_W: f64 = 340.0;
const CUT: f64 = (1.0 + (0.73 - 0.5) * 1.76) / 2.0;
const TASKBAR: f64 = 0.2;
const LEDGE: [&str; 5] = ["bonk", "dip", "tow", "slump_l", "slump_r"];
const RATES: [f64; 5] = [0.25, 0.5, 1.0, 2.0, 4.0];

#[derive(Clone, Copy, PartialEq)]
enum Open {
    None,
    Solo,
    Rate,
}

struct Ed {
    assets: PathBuf,
    motion: Motion,
    preview: Preview,
    touch: TouchInput,
    renderer: Renderer,
    #[cfg(windows)]
    gpu: Option<crate::render::gpu::Gpu>,
    frame: Frame,
    hands: Frame,
    skin: Skin,
    size: f64,
    follow: bool,
    idle: bool,
    reduced: bool,
    pose: (f64, f64, f64),
    light: bool,
    adv: bool,
    open: Open,
    solo: Option<usize>,
    master: Option<(usize, usize, Vec<u32>)>,
    show_master: bool,
    status: (&'static str, String),
    rail_scroll: f64,
    pointer: Option<(f64, f64)>,
    pressed: bool,
    wake: bool,
    last: f64,
}

pub fn run(assets: &Path) -> Result<(), String> {
    use windows::core::w;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::*;
    unsafe {
        let _ = windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let rig = Rig::load(assets)?;
    let mut renderer = Renderer::new(&rig, loader(assets, &rig, 1));
    renderer.padding = 0.0;
    let skin = hands::sample_skin(&renderer);
    #[cfg(windows)]
    let gpu = crate::render::gpu::Gpu::new(&renderer).ok();
    let mut win = UiWin::create(
        w!("BluefishEditor"),
        w!("蓝色肥鱼 · 动画编辑器"),
        false,
        WS_OVERLAPPEDWINDOW,
        windows::Win32::UI::WindowsAndMessaging::WINDOW_EX_STYLE(0),
        1100,
        800,
    )
    .ok_or("cannot open the editor window")?;
    let icon_path: Vec<u16> = assets.join("icon.ico").to_string_lossy().encode_utf16().chain(Some(0)).collect();
    unsafe {
        if let Ok(h) = LoadImageW(None, windows::core::PCWSTR(icon_path.as_ptr()), IMAGE_ICON, 32, 32, LR_LOADFROMFILE) {
            SendMessageW(win.hwnd, WM_SETICON, windows::Win32::Foundation::WPARAM(1), windows::Win32::Foundation::LPARAM(h.0 as isize));
        }
        // 1100 x 800 CSS px, like the Electron editor.
        let k = win.scale;
        let _ = SetWindowPos(win.hwnd, HWND::default(), 0, 0, (1100.0 * k) as i32, (800.0 * k) as i32, SWP_NOMOVE | SWP_NOZORDER);
        let _ = ShowWindow(win.hwnd, SW_SHOW);
    }
    let master = crate::render::texture::Image::load_png(&assets.join("master.png")).ok().map(|img| {
        let px = img.px.chunks_exact(4).map(|c| {
            let a = c[3] as u32;
            let m = |v: u8| (v as u32 * a + 127) / 255;
            a << 24 | m(c[0]) << 16 | m(c[1]) << 8 | m(c[2])
        });
        (img.w, img.h, px.collect())
    });
    let mut motion = Motion::new(Rand::from_clock());
    motion.reduced = false;
    let clock = Instant::now();
    let mut ed = Ed {
        assets: assets.to_path_buf(),
        motion,
        preview: Preview::default(),
        touch: TouchInput::default(),
        renderer,
        #[cfg(windows)]
        gpu,
        frame: Frame::new(1, 1),
        hands: Frame::new(1, 1),
        skin,
        size: 460.0,
        follow: true,
        idle: true,
        reduced: false,
        pose: (0.0, 0.0, 0.0),
        light: false,
        adv: false,
        open: Open::None,
        solo: None,
        master,
        show_master: false,
        status: ("ok", "本地运行中".into()),
        rail_scroll: 0.0,
        pointer: None,
        pressed: false,
        wake: false,
        last: 0.0,
    };
    // --preview <name> [--at <seconds>]: open on a preview, like the web editor's ?preview=&at=.
    let args: Vec<String> = std::env::args().collect();
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    if let Some(name) = arg("--preview") {
        if ed.preview.select(&mut ed.motion, &name).is_ok() {
            if let Some(at) = arg("--at").and_then(|v| v.parse::<f64>().ok()) {
                ed.preview.seek(&mut ed.motion, at);
                ed.preview.playing = false;
            }
        }
    }
    let mut msg = MSG::default();
    let mut next = 0.0;
    loop {
        unsafe {
            while PeekMessageW(&mut msg, HWND::default(), 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_QUIT {
                    return Ok(());
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        let mut quit = false;
        loop {
            let ev = super::INPUT.with(|q| q.borrow_mut().pop_front());
            let Some(ev) = ev else { break };
            if let Input::Ui(_, e) = ev {
                match e {
                    UiEv::Close => quit = true,
                    UiEv::Size | UiEv::Paint => win.refresh_scale(),
                    e => {
                        win.feed(e);
                    }
                }
            }
        }
        if quit {
            unsafe {
                let _ = DestroyWindow(win.hwnd);
            }
            return Ok(());
        }
        let now = clock.elapsed().as_secs_f64();
        if now >= next {
            next = now + 1.0 / 60.0;
            let dt = (now - ed.last).clamp(0.0, 0.1);
            ed.last = now;
            ed.tick(dt, now, &win);
            let (w, h) = win.client_css();
            win.size = (w.max(1.0), h.max(1.0));
            win.theme = LIGHT;
            win.render(|ui| ed.frame_ui(ui));
        }
        let wait = ((next - clock.elapsed().as_secs_f64()) * 1000.0).max(0.0) as u32;
        unsafe {
            MsgWaitForMultipleObjects(None, false, wait.min(16), QS_ALLINPUT);
        }
    }
}

impl Ed {
    fn stage(&self, w: f64, h: f64) -> (f64, f64, f64, f64) {
        (8.0, 8.0, (w - 16.0 - RAIL_W - 8.0).max(120.0), (h - 16.0).max(120.0))
    }
    fn side(&self, sw: f64, sh: f64) -> f64 {
        self.size.min(((sw.min(sh)) - 24.0).floor()).max(120.0).min(640.0)
    }
    /// Steps her (or the preview) once.
    fn tick(&mut self, dt: f64, now: f64, win: &UiWin) {
        let (w, h) = win.client_css();
        let (sx, sy, sw, sh) = self.stage(w, h);
        let side = self.side(sw, sh);
        let (cx, cy) = (sx + (sw - side) / 2.0, sy + (sh - side) / 2.0);
        if self.preview.active {
            self.preview.step(&mut self.motion, dt);
        } else {
            let p = self.pointer;
            let (x, y) = p.map_or((f64::NAN, f64::NAN), |(px, py)| (px - cx, py - cy));
            let i = AttentionInput {
                now,
                reduced: self.motion.reduced,
                follow: self.motion.follow,
                x,
                y,
                size: side,
                near: p.is_some(),
                over_head: p.is_some() && head_contact(x, y, side),
                hx: (x / side - 0.5) / 0.3,
                hy: (y / side - 0.46) / 0.23,
                blocked: self.touch.active.is_some() || self.motion.touch.bonking(),
                wake: self.wake,
                poke: self.touch.active.is_some(),
                ..AttentionInput::default()
            };
            self.motion.attention.update(dt, &i, &mut self.motion.wake);
            self.wake = false;
            self.motion.step(dt);
        }
    }
    /// Applies the local settings to Motion (app.mjs apply()).
    fn apply(&mut self) {
        self.motion.follow = self.follow;
        self.motion.idle = self.idle;
        self.motion.reduced = self.reduced;
        self.motion.pose = self.pose;
    }
    fn end_touch(&mut self) {
        self.touch.end(&mut self.motion.touch, true);
        self.touch.drags.clear();
        self.pressed = false;
    }
    fn set_status(&mut self, state: &'static str, text: impl Into<String>) {
        self.status = (state, text.into());
    }
    fn import(&mut self, text: &str) {
        let r = (|| -> Result<(), String> {
            if text.len() > 100_000 {
                return Err("文件超过 100KB".into());
            }
            let v: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
            if v.get("cues").is_some() {
                for (delay, cue) in from_promptsoul_segment(&v, 3.0)? {
                    self.motion.play_cue(cue, delay)?;
                }
            } else {
                self.motion.play_cue(validate_cue(&v)?, 0.0)?;
            }
            Ok(())
        })();
        match r {
            Ok(()) => self.set_status("ok", "动作已加入播放队列"),
            Err(e) => self.set_status("error", e),
        }
    }

    fn frame_ui(&mut self, ui: &mut Ui) {
        let t = ui.t();
        let (w, h) = (ui.p_size().0, ui.p_size().1);
        ui.p.clear(Some(t.paper));
        self.stage_ui(ui, w, h);
        self.rail_ui(ui, w, h);
    }

    // ---- stage -------------------------------------------------------------------------------
    fn stage_ui(&mut self, ui: &mut Ui, w: f64, h: f64) {
        let t = ui.t();
        let (sx, sy, sw, sh) = self.stage(w, h);
        if self.light {
            ui.p.vgradient(sx, sy, sw, sh, R_CARD, Color::hex(0xf7f9fa), Color::hex(0xe3e9ec));
        } else {
            ui.p.vgradient(sx, sy, sw, sh, R_CARD, Color::hex(0x3d565f), Color::hex(0xc4d2d8));
        }
        let side = self.side(sw, sh);
        let (cx, cy) = (sx + (sw - side) / 2.0, sy + (sh - side) / 2.0);
        let cur = self.motion.current;
        let ledge = self.preview.active && LEDGE.contains(&self.preview.name);
        let tow = if self.preview.active { self.preview.stage_shift(&self.motion) * side / 240.0 } else { 0.0 };
        let lean = cur.slump_side * cur.slump * 0.13 * side;
        let (dx, dy) = (lean + tow, (cur.touch.dip + 0.05 * cur.slump) * side);
        let cut_y = cy + CUT * side;
        let bar = (TASKBAR * side).round();
        let k = ui_scale(ui);
        // Her, into a stage-sized frame (device px).
        let (fw, fh) = ((w * k).round() as usize, (h * k).round() as usize);
        self.frame.resize(fw, fh);
        self.frame.clear();
        let rect = Rect { left: cx + dx, top: cy + dy, width: side, height: side };
        self.renderer.solo = self.solo;
        self.renderer.prepare(&cur, rect);
        let clip_bottom = if ledge { (cut_y * k).round() as i32 } else { ((sy + sh) * k).round() as i32 };
        let target = Target {
            ox: (cx + dx) * k,
            oy: (cy + dy) * k,
            size: side * k,
            clip: [(sx * k) as i32, (sy * k) as i32, ((sx + sw) * k) as i32, clip_bottom],
        };
        if !self.show_master {
            #[cfg(windows)]
            let drawn = self.gpu.as_mut().is_some_and(|g| g.draw(&self.renderer, &mut self.frame, &cur, target).is_ok());
            #[cfg(not(windows))]
            let drawn = false;
            if !drawn {
                self.frame.clear();
                self.renderer.raster(&mut self.frame, &cur, target);
            }
            ui.p.image(&self.frame.px, self.frame.w, self.frame.h, 0.0, 0.0, w, h, false);
        } else if let Some((mw, mh, px)) = &self.master {
            let s = side * 0.88;
            ui.p.image(px, *mw, *mh, cx + (side - s) / 2.0, cy + (side - s) / 2.0, s, s, true);
        }
        // The desktop stand-ins for the duck, tow and wall previews.
        let wall = if self.preview.active && self.preview.name.starts_with("slump_") {
            if self.preview.name.ends_with("_l") {
                -1.0
            } else {
                1.0
            }
        } else {
            0.0
        };
        let wall_x = cx + side / 2.0 + wall * (if wall < 0.0 { 0.37 } else { 0.4 } + 0.07) * side;
        if ledge {
            let (bx0, bx1) = if wall > 0.0 {
                (sx, wall_x)
            } else if wall < 0.0 {
                (wall_x, sx + sw)
            } else {
                (sx, sx + sw)
            };
            ui.p.clip(sx, sy, sw, sh);
            self.taskbar(ui, bx0, bx1, cut_y, bar);
            ui.p.rrect(sx, cut_y + bar, sw, (sy + sh - cut_y - bar).max(0.0), 0.0, Color::hex(0x0b0c0f));
            if wall != 0.0 {
                let (ex, ew) = if wall > 0.0 { (wall_x, sx + sw - wall_x) } else { (sx, wall_x - sx) };
                ui.p.rrect(ex, sy, ew, sh, 0.0, Color::hex(0x0b0c0f));
                let lx = if wall > 0.0 { wall_x } else { wall_x - 1.0 };
                ui.p.rrect(lx, sy, 1.0, sh, 0.0, Color::hex(0xffffff).alpha(0.10));
            }
            ui.p.unclip();
        }
        // Hands: on the ledge, and on her head for the guard / eye rub.
        self.hands.resize(fw, fh);
        self.hands.clear();
        if self.solo.is_none() {
            let gestures = if cur.touch.guard > 0.001 || cur.rub_eyes > 0.001 { hands::head_gesture(&mut self.renderer, &cur, rect, if ledge { dy } else { 0.0 }) } else { Vec::new() };
            if ledge {
                let mut alpha = [1.0, 1.0];
                for (i, g) in &gestures {
                    alpha[*i] *= 1.0 - g.alpha;
                }
                let mut rest = [crate::motion::peek::Hand::default(); 2];
                if lean != 0.0 {
                    for (i, r) in rest.iter_mut().enumerate() {
                        r.x = lean * if i == if lean < 0.0 { 0 } else { 1 } { 0.75 } else { 0.4 };
                    }
                }
                let hs = hands::resting(cx + side / 2.0 + tow, cut_y, side, &rest, alpha);
                hands::draw(&mut self.hands, &hs, &self.skin, k, Some(cut_y + bar * 0.5));
            }
            let head: Vec<HandDraw> = gestures.iter().map(|g| g.1).collect();
            hands::draw(&mut self.hands, &head, &self.skin, k, if ledge { Some(cut_y) } else { None });
            ui.p.image(&self.hands.px, self.hands.w, self.hands.h, 0.0, 0.0, w, h, false);
            // The tow preview's virtual pointer.
            if let (Some((px, py)), Some(&li)) = (self.preview.pointer(&self.motion), self.renderer.by_name.get("ahoge")) {
                let o = self.renderer.project(TOW_GRIP.x, TOW_GRIP.y, &cur, li, true, None);
                let kk = side / 240.0;
                let x = rect.left + (o.0 + 1.0) / 2.0 * side + px * kk;
                let y = rect.top + (1.0 - o.1) / 2.0 * side + py * kk;
                let r = 5f64.max(7.0 * kk * 0.6);
                ui.p.circle(x, y, r + 1.0, Color::hex(0x141e3c).alpha(0.75));
                ui.p.circle(x, y, r - 1.0, Color::hex(0xffffff).alpha(0.85));
            }
        }
        // Status dot and the background switch.
        let (state, text) = (self.status.0, self.status.1.clone());
        ui.dot(sx + 8.0 + 14.0, sy + sh - 8.0 - 14.0, state);
        if ui.hover(sx + 8.0, sy + sh - 36.0, 28.0, 28.0) {
            let (tw, _) = measure(&text, SMALL, 400.0, false);
            ui.p.rrect(sx + 40.0, sy + sh - 34.0, tw + 16.0, 24.0, 12.0, Color::hex(0x161616).alpha(0.8));
            ui.p.text(&text, sx + 48.0, sy + sh - 31.0, tw + 4.0, SMALL, Color::hex(0xffffff), Align::Left, false);
        }
        let fg = if self.light { t.ink } else { Color::hex(0xffffff) };
        let (bx, by) = (sx + sw - 8.0 - 44.0, sy + sh - 8.0 - 44.0);
        let (hov, clicked) = ui.area(900, bx, by, 44.0, 44.0);
        if hov {
            ui.p.circle(bx + 22.0, by + 22.0, 16.0, if self.light { Color::hex(0).alpha(0.07) } else { Color::hex(0xffffff).alpha(0.15) });
        }
        ui.p.icon(if self.light { "moon" } else { "sun" }, bx + 13.0, by + 13.0, 18.0, fg);
        if clicked {
            self.light = !self.light;
        }
        // Touching her.
        let inside = ui.hover(sx, sy, sw, sh) && !ui.hover(bx, by, 44.0, 44.0);
        let mouse = ui.input.mouse;
        if inside {
            if let Some((mx, my)) = mouse {
                self.pointer = Some((mx, my));
                let (lx, ly) = (mx - rect.left, my - rect.top);
                self.motion.set_gaze((lx - side * 0.5) / (side * 0.7), (ly - side * 0.6) / (side * 0.7));
                let hit = self.renderer.pick_hit(lx, ly, side);
                let part = hit.and_then(|h| (h.part == "hair_front").then_some(Part::HairFront));
                let grip = hit.map(|h| crate::motion::touch::Grip { source: h.source, binding: h.binding, outline: h.outline, relative: false });
                self.touch.hover(&mut self.motion.touch, part, Some(Point::local(mx, my)), side, grip.as_ref());
            }
        } else if self.pointer.is_some() && !self.pressed {
            self.pointer = None;
            self.motion.set_gaze(0.0, 0.0);
            self.touch.hover(&mut self.motion.touch, None, None, side, None);
        }
        if let Some((mx, my)) = mouse {
            if ui.input.pressed && inside && !self.pressed && !self.motion.touch.bonking() {
                let (lx, ly) = (mx - rect.left, my - rect.top);
                let on_her = self.frame.alpha((mx * k) as usize, (my * k) as usize) > 24;
                if on_her {
                    if self.preview.active {
                        self.preview.release(&mut self.motion);
                        self.apply();
                    }
                    self.pressed = true;
                    if self.motion.attention.current.sleeping {
                        self.motion.touch.head_tap = None;
                        self.wake = true;
                    } else {
                        let hit = self.renderer.pick_hit(lx, ly, side);
                        let part = hit.and_then(|h| match h.part {
                            "ahoge" => Some(Part::Ahoge),
                            "hair_front" => Some(Part::HairFront),
                            "ear_l" => Some(Part::EarL),
                            "ear_r" => Some(Part::EarR),
                            _ => None,
                        });
                        let grip = hit.map(|h| crate::motion::touch::Grip { source: h.source, binding: h.binding, outline: h.outline, relative: false });
                        let head = part == Some(Part::HairFront) || (part.is_none() && head_contact(lx, ly, side));
                        self.touch.begin(&mut self.motion.touch, part, Point::local(mx, my), side, grip.as_ref(), head, false);
                        if part.is_none() {
                            self.motion.blink();
                        }
                    }
                }
            } else if self.pressed && ui.input.down {
                self.touch.move_to(&mut self.motion.touch, Point::local(mx, my));
            }
            if self.pressed && ui.input.released {
                self.touch.move_to(&mut self.motion.touch, Point::local(mx, my));
                self.touch.end(&mut self.motion.touch, false);
                self.touch.drags.clear();
                self.pressed = false;
            }
        }
        let _ = clamp;
    }
    fn taskbar(&self, ui: &mut Ui, x0: f64, x1: f64, y: f64, bar: f64) {
        let light = self.light;
        let w = x1 - x0;
        ui.p.rrect(x0, y, w, bar, 0.0, if light { Color::hex(0xf3f3f3).alpha(0.92) } else { Color::hex(0x202020).alpha(0.92) });
        ui.p.rrect(x0, y, w, 1.0, 0.0, if light { Color::hex(0).alpha(0.06) } else { Color::hex(0xffffff).alpha(0.08) });
        let icon = bar * 0.5;
        let soft = if light { Color::hex(0).alpha(0.10) } else { Color::hex(0xffffff).alpha(0.15) };
        // Centred apps: start, search, four apps.
        let gap = bar * 0.16;
        let mut widths = vec![icon, bar * 2.4, icon, icon, icon, icon];
        // Centred on the bar, unless that would run into the tray: then left of it.
        let f = Font { size: (bar * 0.22).max(8.0), weight: 400, mono: false };
        let (cw0, _) = measure("00:00
0000/00/00", f, 200.0, false);
        let tray_left = x1 - bar * 0.25 - cw0 - bar * 0.2 - 2.0 * (icon * 0.55) - bar * 0.18 - gap;
        // A narrow bar (the wall preview) keeps fewer apps rather than overlapping the tray.
        let span = |w: &Vec<f64>| w.iter().sum::<f64>() + gap * (w.len() as f64 - 1.0);
        while widths.len() > 2 && span(&widths) > tray_left - x0 - gap {
            widths.pop();
        }
        let total = span(&widths);
        let mut x = (x0 + (w - total) / 2.0).min(tray_left - total).max(x0 + gap);
        let iy = y + (bar - icon) / 2.0;
        for (i, iw) in widths.iter().enumerate() {
            let c = match i {
                0 => Color::hex(0x2a95e0),
                1 => if light { Color::hex(0).alpha(0.05) } else { Color::hex(0xffffff).alpha(0.12) },
                2 => soft,
                3 => Color::hex(0xe8a33d),
                4 => Color::hex(0x3f8ee8),
                _ => Color::hex(0x5bb974),
            };
            let r = if i == 1 { icon / 2.0 } else { icon * 0.22 };
            ui.p.rrect(x, iy, *iw, icon, r, c);
            x += iw + gap;
        }
        // Tray: two dots and the clock.
        let (y_, m_, d_, _, h_, mi_) = crate::chat::text::local(crate::chat::text::now_ms());
        let clock = format!("{h_:02}:{mi_:02}\n{y_}/{m_}/{d_}");
        let (cw, ch) = measure(&clock, f, 200.0, false);
        let tx = x1 - bar * 0.25 - cw;
        ui.p.text(&clock, tx, y + (bar - ch) / 2.0, cw + 2.0, f, if light { Color::hex(0).alpha(0.85) } else { Color::hex(0xffffff).alpha(0.87) }, Align::Right, false);
        let dot = icon * 0.55;
        for i in 0..2 {
            ui.p.circle(tx - bar * 0.2 - dot / 2.0 - i as f64 * (dot + bar * 0.18), y + bar / 2.0, dot / 2.0, if light { Color::hex(0).alpha(0.2) } else { Color::hex(0xffffff).alpha(0.25) });
        }
    }

    // ---- rail ---------------------------------------------------------------------------------
    fn rail_ui(&mut self, ui: &mut Ui, w: f64, h: f64) {
        let t = ui.t();
        let (rx, ry, rh) = (w - 8.0 - RAIL_W, 8.0, (h - 16.0).max(100.0));
        let content = self.rail_height();
        let max = (content - rh).max(0.0);
        if ui.hover(rx, ry, RAIL_W, rh) && ui.input.wheel != 0.0 {
            self.rail_scroll = (self.rail_scroll - ui.input.wheel * 0.5).clamp(0.0, max);
            ui.input.wheel = 0.0;
        }
        self.rail_scroll = self.rail_scroll.clamp(0.0, max);
        ui.p.clip(rx, ry, RAIL_W, rh);
        ui.st.clip = Some((rx, ry, RAIL_W, rh));
        let mut y = ry - self.rail_scroll;
        let (x, iw) = (rx + 24.0, RAIL_W - 48.0);
        let card = |ui: &mut Ui, y: f64, h: f64| ui.p.rrect(rx, y, RAIL_W, h, R_CARD, t.card);
        // Size.
        card(ui, y, 112.0);
        ui.p.icon("size", x, y + 24.0 + 7.0, 18.0, t.ink);
        ui.p.text(&format!("{}", self.size.round()), x + iw - 60.0, y + 27.0, 60.0, NUM, t.ink, Align::Right, false);
        if let Some(v) = ui.slider(1, x, y + 24.0 + 32.0 + 8.0, iw, self.size, 150.0, 460.0, 1.0) {
            self.size = v;
        }
        y += 112.0 + 8.0;
        // Previews.
        let rows = PREVIEWS.len().div_ceil(2);
        let grid_h = rows as f64 * 40.0 + (rows - 1) as f64 * 8.0;
        let transport = if self.preview.active { 8.0 + 24.0 + 8.0 + 40.0 } else { 0.0 };
        let ph = 24.0 + grid_h + transport + 24.0;
        card(ui, y, ph);
        let bw = (iw - 8.0) / 2.0;
        for (i, &(key, label, _)) in PREVIEWS.iter().enumerate() {
            let (bx, by) = (x + (i % 2) as f64 * (bw + 8.0), y + 24.0 + (i / 2) as f64 * 48.0);
            let on = self.preview.active && self.preview.name == key;
            if ui.rect_button(100 + i as u64, bx, by, bw, 40.0, label, on) {
                self.end_touch();
                let _ = self.preview.select(&mut self.motion, key);
            }
        }
        if self.preview.active {
            let ty = y + 24.0 + grid_h + 8.0;
            let dur = self.preview.duration;
            if let Some(v) = ui.slider(2, x, ty, iw, self.preview.time, 0.0, dur, 0.01) {
                self.preview.seek(&mut self.motion, v);
            }
            let cy = ty + 24.0 + 8.0;
            if ui.rect_button(3, x, cy, 64.0, 40.0, if self.preview.playing { "暂停" } else { "播放" }, false) {
                if self.preview.time >= self.preview.duration {
                    self.preview.seek(&mut self.motion, 0.0);
                }
                self.preview.playing = !self.preview.playing;
            }
            let f = Font { size: 14.0, weight: 500, mono: true };
            ui.p.text(&format!("{:.1} / {}", self.preview.time, dur), x + 72.0, cy + 10.0, iw - 72.0 - 86.0, f, t.ink, Align::Center, false);
            let rate = format!("{}×", self.preview.rate);
            if ui.select_box(4, x + iw - 78.0, cy, 78.0, 40.0, &rate, self.open == Open::Rate, R_XS) {
                self.open = if self.open == Open::Rate { Open::None } else { Open::Rate };
            }
        }
        let rate_anchor = (x + iw - 78.0, y + 24.0 + grid_h + 8.0 + 24.0 + 8.0 + 44.0);
        y += ph + 8.0;
        // Axes.
        card(ui, y, 24.0 + 3.0 * 58.0 + 16.0 + 24.0);
        let mut ay = y + 24.0;
        let fmt = |v: f64| format!("{:.1}°", if v.abs() < 0.05 { 0.0 } else { v });
        for (i, (icon, min, max)) in [("yaw", -8.0, 18.0), ("pitch", -12.0, 12.0), ("roll", -10.0, 10.0)].into_iter().enumerate() {
            ui.p.icon(icon, x, ay + 7.0, 18.0, t.ink);
            let v = [self.pose.0, self.pose.1, self.pose.2][i];
            ui.p.text(&fmt(v), x + iw - 100.0, ay + 3.0, 100.0, NUM, t.ink, Align::Right, false);
            let (_, _) = ui.area(20 + i as u64, x + iw - 100.0, ay, 100.0, 32.0);
            let reset = ui.input.double && ui.hover(x + iw - 100.0, ay, 100.0, 32.0);
            let nv = if reset { Some(0.0) } else { ui.slider(10 + i as u64, x, ay + 34.0, iw, v, min, max, 0.1) };
            if let Some(nv) = nv {
                match i {
                    0 => self.pose.0 = nv,
                    1 => self.pose.1 = nv,
                    _ => self.pose.2 = nv,
                }
                self.motion.pose = self.pose;
                if self.preview.active {
                    self.preview.base_pose = self.pose;
                }
                if self.follow {
                    self.follow = false;
                    self.motion.follow = false;
                }
            }
            ay += 58.0 + 8.0;
        }
        y += 24.0 + 3.0 * 58.0 + 16.0 + 24.0 + 8.0;
        // Gestures.
        card(ui, y, 24.0 + 88.0 + 24.0);
        let pw = (iw - 16.0) / 3.0;
        let gestures = [("blink", "blink"), ("wink", "wink"), ("nod", "nod"), ("shake", "shakehead"), ("happy", "happy"), ("reset", "reset")];
        for (i, (icon, name)) in gestures.into_iter().enumerate() {
            let (px, py) = (x + (i % 3) as f64 * (pw + 8.0), y + 24.0 + (i / 3) as f64 * 48.0);
            if ui.pill(30 + i as u64, px, py, pw, 40.0, "", Some(icon), false, t.fill) {
                if name == "reset" {
                    self.end_touch();
                    self.preview.stop(&mut self.motion);
                    self.follow = true;
                    self.pose = (0.0, 0.0, 0.0);
                    self.apply();
                } else {
                    self.preview.stop(&mut self.motion);
                    self.apply();
                    self.motion.gesture(name);
                }
            }
        }
        y += 24.0 + 88.0 + 24.0 + 8.0;
        // Modes.
        card(ui, y, 24.0 + 44.0 + 24.0);
        let col = (iw - 44.0) / 3.0;
        let modes = [("follow", self.follow), ("idle", self.idle), ("reduced", self.reduced)];
        for (i, (icon, on)) in modes.into_iter().enumerate() {
            let pressed = if self.preview.active { [self.motion.follow, self.motion.idle, self.motion.reduced][i] } else { on };
            if ui.icon_button(40 + i as u64, x + i as f64 * col, y + 24.0, icon, pressed, false) {
                self.preview.stop(&mut self.motion);
                match i {
                    0 => self.follow = !self.follow,
                    1 => self.idle = !self.idle,
                    _ => self.reduced = !self.reduced,
                }
                self.apply();
            }
        }
        y += 24.0 + 44.0 + 24.0 + 8.0;
        // Advanced.
        let adv_h = 12.0 + 32.0 + if self.adv { 8.0 + 36.0 + 8.0 + 44.0 } else { 0.0 } + 12.0;
        card(ui, y, adv_h);
        ui.p.icon("layers", x, y + 12.0 + 7.0, 18.0, t.ink);
        let (bx, by) = (x + iw - 44.0 + 6.0, y + 12.0 - 6.0);
        let (hov, clicked) = ui.area(50, bx, by, 44.0, 44.0);
        if hov {
            ui.p.circle(bx + 22.0, by + 22.0, 16.0, t.fill);
        }
        ui.p.icon("chevron", bx + 13.0, by + 13.0 + if self.adv { 0.0 } else { 0.0 }, 18.0, t.ink);
        if clicked {
            self.adv = !self.adv;
            self.open = Open::None;
        }
        let mut solo_anchor = None;
        if self.adv {
            let sy0 = y + 12.0 + 32.0 + 8.0;
            let current = self.solo.map(|i| self.renderer.layers[i].name.clone()).unwrap_or_else(|| "—".into());
            if ui.select_box(51, x, sy0, iw, 36.0, &current, self.open == Open::Solo, R_XS) {
                self.open = if self.open == Open::Solo { Open::None } else { Open::Solo };
            }
            solo_anchor = Some((x, sy0 + 40.0));
            let ty = sy0 + 36.0 + 8.0;
            if ui.icon_button(52, x, ty, "compare", self.show_master, false) {
                self.show_master = !self.show_master;
            }
            if ui.icon_button(53, x + 48.0, ty, "upload", false, false) {
                if let Some(text) = open_json() {
                    self.import(&text);
                }
            }
            if ui.icon_button(54, x + 96.0, ty, "play", false, false) {
                match std::fs::read_to_string(self.assets.parent().unwrap_or(&self.assets).join("examples").join("promptsoul-segment.json")) {
                    Ok(text) => self.import(&text),
                    Err(_) => self.set_status("error", "示例文件加载失败"),
                }
            }
        }
        // Open lists draw last, over the cards.
        if self.open == Open::Rate && self.preview.active {
            let items: Vec<String> = RATES.iter().map(|r| format!("{r}×")).collect();
            let cur = format!("{}×", self.preview.rate);
            if let Some(i) = ui.select_list(500, rate_anchor.0 - 40.0, rate_anchor.1, 118.0, &items, &cur, 30.0) {
                self.preview.rate = RATES[i];
                self.open = Open::None;
            }
        }
        if let (Open::Solo, Some((ax, ay))) = (self.open, solo_anchor) {
            let mut items = vec!["—".to_string()];
            items.extend(self.renderer.layers.iter().map(|l| l.name.clone()));
            let cur = self.solo.map(|i| self.renderer.layers[i].name.clone()).unwrap_or_else(|| "—".into());
            if let Some(i) = ui.select_list(600, ax, ay, iw, &items, &cur, 28.0) {
                self.solo = if i == 0 { None } else { Some(i - 1) };
                self.open = Open::None;
            }
        }
        if ui.input.pressed && self.open != Open::None && !ui.hover(x, ry, iw, rh) {
            self.open = Open::None;
        }
        ui.st.clip = None;
        ui.p.unclip();
        if max > 0.0 {
            let th = rh * rh / content;
            ui.p.rrect(rx + RAIL_W - 6.0, ry + (rh - th) * self.rail_scroll / max, 5.0, th, 2.5, Color::hex(0xd4d4d4));
        }
    }
    fn rail_height(&self) -> f64 {
        let rows = PREVIEWS.len().div_ceil(2) as f64;
        let grid = rows * 40.0 + (rows - 1.0) * 8.0;
        let transport = if self.preview.active { 80.0 } else { 0.0 };
        let adv = 12.0 + 32.0 + if self.adv { 96.0 } else { 0.0 } + 12.0;
        112.0 + 8.0 + (48.0 + grid + transport) + 8.0 + (24.0 + 3.0 * 58.0 + 40.0) + 8.0 + 136.0 + 8.0 + 92.0 + 8.0 + adv + if self.adv { 300.0 } else { 0.0 }
    }
}

fn ui_scale(ui: &Ui) -> f64 {
    ui.p_scale()
}

/// A JSON file from the open dialog.
fn open_json() -> Option<String> {
    use windows::Win32::UI::Controls::Dialogs::*;
    let mut buf = vec![0u16; 1024];
    let filter: Vec<u16> = "动作 JSON\0*.json\0所有文件\0*.*\0\0".encode_utf16().collect();
    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        lpstrFilter: windows::core::PCWSTR(filter.as_ptr()),
        lpstrFile: windows::core::PWSTR(buf.as_mut_ptr()),
        nMaxFile: buf.len() as u32,
        Flags: OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR,
        ..Default::default()
    };
    unsafe {
        if !GetOpenFileNameW(&mut ofn).as_bool() {
            return None;
        }
    }
    let n = buf.iter().position(|c| *c == 0).unwrap_or(0);
    std::fs::read_to_string(String::from_utf16_lossy(&buf[..n])).ok()
}
