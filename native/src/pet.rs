//! overlay.mjs: the pet window's brain stem. Lays her out in the window, routes presses (drag,
//! ahoge pull and tow, fringe, ears, head taps, single-click chat), steps Motion and Peek every
//! frame and draws her. Window-system agnostic: the host feeds pointer/button events and the
//! clock, and carries out the `Effect`s it gets back.
use crate::dock::VIEW_PAD;
use crate::hands::{self, HandDraw, Skin};
use crate::motion::attention::{head_contact, AttentionInput};
use crate::motion::peek::{Peek, PeekInput, PeekOut};
use crate::motion::touch::{Grip, Part, Point, TouchInput};
use crate::motion::tow::DipKind;
use crate::motion::{Motion, Pose};
use crate::render::raster::{Frame, Target};
use crate::render::{Rect, Renderer};
use crate::util::{clamp, sign, Rand};

/// Art-space y (0..1) of the cut line that lands on the taskbar edge.
pub const CUT_ART_Y: f64 = 0.73;
const RENDER_Y_SCALE: f64 = 1.76;
const GRIP_RATIO: f64 = 0.05;
const NEAR_MIN: f64 = 180.0;
const NEAR_RATIO: f64 = 1.05;
pub const ACTIVE_FPS: f64 = 60.0;
pub const IDLE_FPS: f64 = 30.0;
const ACTIVE_FOR: f64 = 2.5;
const CLICK_MAX: f64 = 0.35;
const CLICK_SLOP: f64 = 0.03;
const CLICK_MIN_SLOP: f64 = 6.0;
const CLICK_CONFIRM: f64 = 0.42;

/// Settings the host owns (window.json).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Settings {
    pub size: f64,
    pub docked: bool,
    pub follow: bool,
    pub idle: bool,
    pub reduced: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Settings { size: 240.0, docked: true, follow: true, idle: true, reduced: false }
    }
}

/// What the host should do.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Effect {
    /// Start (true) or end (false) carrying the window with the cursor.
    Drag(bool),
    /// Docked ahoge tow: move the window to this screen x (CSS px of the window's left edge).
    Tow(f64),
    Menu,
    Chat,
    /// Ctrl+wheel: grow (positive) or shrink by this many steps.
    Zoom(f64),
}

/// The cursor as the host polls it (main.cjs's 33 ms pointer message).
#[derive(Clone, Copy, Debug)]
pub struct PointerInfo {
    /// Window-local CSS px.
    pub x: f64,
    pub y: f64,
    /// Screen CSS px.
    pub sx: f64,
    pub sy: f64,
    pub gx: f64,
    pub gy: f64,
    pub inner_side: f64,
    /// Docked: the window's x and the range it may travel.
    pub track: Option<(f64, f64, f64)>,
    /// Docked: the wall the head rests near (side, gap).
    pub wall: (f64, f64),
}

#[derive(Clone, Copy, Debug, Default)]
struct Layout {
    w: f64,
    h: f64,
    s: f64,
    docked: bool,
    _grip: f64,
    ledge_y: f64,
    dpr: f64,
}
#[derive(Clone, Copy, Debug)]
struct Down {
    x: f64,
    y: f64,
    at: f64,
    blocked: bool,
}

pub struct Pet {
    pub settings: Settings,
    pub motion: Motion,
    pub peek: Peek,
    pub touch: TouchInput,
    pub renderer: Renderer,
    #[cfg(windows)]
    gpu: Option<crate::render::gpu::Gpu>,
    skin: Skin,
    l: Layout,
    pos: (f64, f64),
    pointer: Option<PointerInfo>,
    pointer_at: f64,
    poke_flag: bool,
    wake_flag: bool,
    drag_on: bool,
    sleep_press: bool,
    pressed: bool,
    track: Option<(f64, f64, f64)>,
    wall: (f64, f64),
    tow_origin: Option<f64>,
    tow_sent: Option<f64>,
    down: Option<Down>,
    chat_at: Option<f64>,
    last: f64,
    active_until: f64,
    last_pointer_key: (f64, f64),
    out: Option<PeekOut>,
    resting_hands: [HandDraw; 2],
    head_hands: Vec<(usize, HandDraw)>,
    effects: Vec<Effect>,
    /// Why the last press did or did not count as a click (tests).
    pub last_click: &'static str,
}

impl Pet {
    pub fn new(renderer: Renderer, settings: Settings, random: Rand, now: f64) -> Pet {
        let mut renderer = renderer;
        renderer.padding = VIEW_PAD;
        let skin = hands::sample_skin(&renderer);
        let mut motion = Motion::new(random.clone());
        motion.reduced = settings.reduced;
        motion.idle = settings.idle;
        motion.follow = settings.follow;
        #[cfg(windows)]
        let gpu = if std::env::var_os("BLUEFISH_CPU").is_some() {
            None
        } else {
            match crate::render::gpu::Gpu::new(&renderer) {
                Ok(g) => Some(g),
                Err(e) => {
                    eprintln!("Direct3D 11 unavailable, drawing on the CPU: {e}");
                    None
                }
            }
        };
        Pet {
            peek: Peek::new(settings.size, random),
            #[cfg(windows)]
            gpu,
            motion,
            touch: TouchInput::default(),
            renderer,
            skin,
            settings,
            l: Layout::default(),
            pos: (0.0, 0.0),
            pointer: None,
            pointer_at: -1e9,
            poke_flag: false,
            wake_flag: false,
            drag_on: false,
            sleep_press: false,
            pressed: false,
            track: None,
            wall: (0.0, 0.0),
            tow_origin: None,
            tow_sent: None,
            down: None,
            chat_at: None,
            last: now,
            active_until: 0.0,
            last_pointer_key: (f64::NAN, f64::NAN),
            out: None,
            resting_hands: [HandDraw::default(); 2],
            head_hands: Vec::new(),
            effects: Vec::new(),
            last_click: "",
        }
    }
    pub fn take_effects(&mut self) -> Vec<Effect> {
        std::mem::take(&mut self.effects)
    }
    pub fn dragging(&self) -> bool {
        self.drag_on
    }

    /// The window's CSS size and device pixel ratio; call when either changes.
    pub fn layout(&mut self, w: f64, h: f64, dpr: f64) {
        let s = self.settings.size;
        let docked = self.settings.docked;
        let grip = if docked { (s * GRIP_RATIO).round() } else { 0.0 };
        self.l = Layout { w, h, s, docked, _grip: grip, ledge_y: h - grip, dpr };
        self.peek.set_size(s);
    }
    pub fn apply_settings(&mut self, next: Settings) {
        self.settings = next;
        self.motion.idle = next.idle;
        self.motion.reduced = next.reduced;
        self.motion.follow = next.follow;
    }
    fn head_fraction() -> f64 {
        (1.0 + (CUT_ART_Y - 0.5) * RENDER_Y_SCALE) / 2.0
    }
    fn slump_shift(&self) -> f64 {
        clamp(self.wall.1 + 0.06 * self.l.s, 0.0, 0.5 * self.l.s)
    }
    fn place(&mut self, offset_x: f64, bob: f64) {
        let Layout { w, h, s, docked, ledge_y, .. } = self.l;
        let cur = &self.motion.current;
        let (sleep, rub_lift) = (cur.sleep, cur.rub_lift * s);
        let (mut left, mut top);
        if docked {
            left = (w - s) / 2.0 + offset_x;
            top = ledge_y - s * Self::head_fraction() + bob + s * 0.085 * sleep - rub_lift;
        } else {
            left = (w - s) / 2.0;
            top = (h - s) / 2.0 + s * 0.025 * sleep - rub_lift;
        }
        let (dip, slump, side) = (cur.touch.dip, cur.slump, cur.slump_side);
        if docked {
            top += s * dip + s * 0.05 * slump;
            if slump != 0.0 && side == self.wall.0 {
                left += side * self.slump_shift() * slump;
            }
        } else {
            top += s * dip * 0.3;
        }
        self.pos = (left, top);
    }
    /// The canvas the head is drawn in, in window CSS px.
    fn canvas_rect(&self) -> Rect {
        let s = self.l.s;
        Rect { left: self.pos.0 - VIEW_PAD * s, top: self.pos.1 - VIEW_PAD * s, width: s * (1.0 + 2.0 * VIEW_PAD), height: s * (1.0 + 2.0 * VIEW_PAD) }
    }

    /// Is the CSS point on one of her hands?
    fn on_hands(&self, x: f64, y: f64) -> bool {
        self.l.docked && (self.resting_hands.iter().any(|h| h.hit(x, y)) || self.head_hands.iter().any(|(_, h)| h.hit(x, y)))
    }
    fn pick(&self, x: f64, y: f64) -> Option<crate::render::Hit> {
        let r = self.canvas_rect();
        self.renderer.pick_hit(x - r.left, y - r.top, r.width)
    }
    fn part_at(&self, x: f64, y: f64) -> Option<(Part, Grip)> {
        if self.on_hands(x, y) || (self.l.docked && y >= self.l.ledge_y) {
            return None;
        }
        let h = self.pick(x, y)?;
        let part = match h.part {
            "ahoge" => Part::Ahoge,
            "hair_front" => Part::HairFront,
            "ear_l" => Part::EarL,
            "ear_r" => Part::EarR,
            _ => return None,
        };
        Some((part, Grip { source: h.source, binding: h.binding, outline: h.outline, relative: false }))
    }
    fn mark_active(&mut self, now: f64) {
        self.active_until = now + ACTIVE_FOR;
    }
    fn pointer_near(&self, p: &PointerInfo) -> bool {
        let s = self.l.s;
        p.x > -s * 0.5 && p.y > -s * 0.5 && p.x < self.l.w + s * 0.5 && p.y < self.l.h + s * 0.5
    }

    // ---- input ---------------------------------------------------------------------------
    pub fn set_pointer(&mut self, p: Option<PointerInfo>, now: f64) {
        self.pointer = p;
        self.pointer_at = now;
        let Some(p) = p else { return };
        if (p.x, p.y) != self.last_pointer_key {
            self.last_pointer_key = (p.x, p.y);
            if self.pointer_near(&p) {
                self.mark_active(now);
            }
        }
        self.track = p.track;
        self.wall = if self.l.docked { (sign(p.wall.0), p.wall.1) } else { (0.0, 0.0) };
        self.motion.wall = self.wall;
        if let (Some((_, min, max)), Some(o)) = (self.track, self.tow_origin) {
            self.motion.touch.tow.set_limits(min - o, max - o);
        }
        let pt = Point::new(p.x, p.y, p.sx, p.sy);
        self.touch.move_to(&mut self.motion.touch, pt);
        self.drain_drags();
        let hover = self.pick(p.x, p.y);
        let part = hover.and_then(|h| (h.part == "hair_front").then_some(Part::HairFront));
        let grip = hover.map(|h| Grip { source: h.source, binding: h.binding, outline: h.outline, relative: false });
        self.touch.hover(&mut self.motion.touch, part, Some(pt), self.l.s, grip.as_ref());
        self.motion.set_gaze(p.gx, p.gy);
    }
    fn drain_drags(&mut self) {
        for on in self.touch.drags.drain(..) {
            self.drag_on = on;
            self.effects.push(Effect::Drag(on));
        }
    }
    fn busy_for_chat(&self) -> bool {
        let a = &self.motion.attention.current;
        a.sleeping || a.woke || self.motion.wake.active() || self.motion.touch.bonking() || self.motion.touch.dip.active || self.touch.active.is_some()
    }
    /// Left button down at a window CSS point. `hit`: whether the drawn frame is opaque there.
    pub fn press(&mut self, x: f64, y: f64, sx: f64, sy: f64, hit: bool, now: f64) {
        let second = self.chat_at.take().is_some();
        if self.pressed || !hit {
            return;
        }
        self.down = Some(Down { x, y, at: now, blocked: second || self.busy_for_chat() });
        self.pressed = true;
        self.mark_active(now);
        let point = Point::new(x, y, sx, sy);
        let s = self.l.s;
        if self.motion.attention.current.sleeping {
            // Asleep: a press can still carry her; the release (moved or not) wakes her up.
            self.motion.touch.head_tap = None;
            self.sleep_press = true;
            self.poke_flag = true;
            self.touch.begin(&mut self.motion.touch, None, point, s, None, false, false);
            self.drain_drags();
            return;
        }
        let found = self.part_at(x, y);
        let part = found.map(|f| f.0);
        let grip = found.filter(|f| matches!(f.0, Part::Ahoge | Part::HairFront)).map(|f| f.1);
        let head = !self.on_hands(x, y) && (part == Some(Part::HairFront) || (part.is_none() && head_contact(x - self.pos.0, y - self.pos.1, s)));
        self.motion.slump.poke();
        let tow = self.l.docked && part == Some(Part::Ahoge);
        if tow {
            self.tow_origin = Some(sx - x);
            self.tow_sent = None;
        }
        self.touch.begin(&mut self.motion.touch, part, point, s, grip.as_ref(), head, tow);
        if let (true, Some((_, min, max)), Some(o)) = (tow, self.track, self.tow_origin) {
            self.motion.touch.tow.set_limits(min - o, max - o);
        }
        self.drain_drags();
        if part.is_none() {
            self.motion.blink();
        }
        self.poke_flag = true;
    }
    pub fn pointer_move(&mut self, x: f64, y: f64, sx: f64, sy: f64) {
        if self.pressed {
            self.touch.move_to(&mut self.motion.touch, Point::new(x, y, sx, sy));
            self.drain_drags();
        }
    }
    /// Button up (`release`) or a lost capture / cancel (`release = None`).
    pub fn release(&mut self, at: Option<(f64, f64, f64, f64)>, now: f64) {
        if let Some((x, y, sx, sy)) = at {
            self.touch.move_to(&mut self.motion.touch, Point::new(x, y, sx, sy));
        }
        let moved = self.touch.active.is_some_and(|a| a.part == Part::Body && a.moved);
        let click = self.pressed && self.click_ended(at, now);
        let bonked = self.touch.end(&mut self.motion.touch, at.is_none());
        self.drain_drags();
        if click && !bonked && !self.motion.touch.bonking() {
            self.chat_at = Some(now + CLICK_CONFIRM);
        }
        if self.sleep_press {
            self.sleep_press = false;
            self.wake_flag = true;
        }
        if moved {
            self.motion.slump.arrive(0.0);
        }
        self.pressed = false;
    }
    fn click_ended(&mut self, at: Option<(f64, f64, f64, f64)>, now: f64) -> bool {
        let d = self.down.take();
        let verdict = match (d, at) {
            (None, _) => "no-press",
            (_, None) => "cancel",
            (Some(d), _) if d.blocked => "blocked",
            (Some(d), Some((x, y, _, _))) => {
                let moved = (x - d.x).hypot(y - d.y) > CLICK_MIN_SLOP.max(self.l.s * CLICK_SLOP) || self.touch.active.is_some_and(|a| a.moved);
                if moved {
                    "moved"
                } else if now - d.at > CLICK_MAX {
                    "long"
                } else {
                    "click"
                }
            }
        };
        self.last_click = verdict;
        verdict == "click"
    }
    pub fn context_menu(&mut self, now: f64) {
        self.release(None, now);
        self.poke_flag = true;
        self.effects.push(Effect::Menu);
    }
    pub fn wheel(&mut self, delta: f64, ctrl: bool, now: f64) {
        self.poke_flag = true;
        self.mark_active(now);
        if ctrl && delta != 0.0 {
            self.effects.push(Effect::Zoom(-sign(delta)));
        }
    }
    /// The window lost focus or got hidden.
    pub fn blur(&mut self, now: f64) {
        if self.pressed {
            self.release(None, now);
        }
        self.touch.hover(&mut self.motion.touch, None, None, self.l.s, None);
    }
    /// A gesture requested from outside (the chat brain, the menu).
    pub fn action(&mut self, name: &str, now: f64) {
        self.mark_active(now);
        match name {
            "reset" => {
                self.poke_flag = true;
                self.release(None, now);
                self.motion.reset();
            }
            // An ear flick is fine even asleep; the rest need her awake.
            "ear" => {
                let side = if self.motion.touch.time.to_bits() & 1 == 0 { 0 } else { 1 };
                self.motion.touch.twitch(side, false);
            }
            _ if self.motion.attention.current.sleeping => {}
            "dip" => {
                self.poke_flag = true;
                if !self.motion.touch.bonking() && self.touch.active.is_none() {
                    self.motion.touch.dip.start(0.0, DipKind::Tow);
                }
            }
            other => {
                self.poke_flag = true;
                self.motion.gesture(other);
            }
        }
    }

    // ---- frame ---------------------------------------------------------------------------
    /// Seconds until the next frame is due.
    pub fn next_frame_in(&self, now: f64) -> f64 {
        let fps = if self.busy(now) { ACTIVE_FPS } else { IDLE_FPS };
        (self.last + 1.0 / fps - now).max(0.0)
    }
    fn busy(&self, now: f64) -> bool {
        now < self.active_until
            || self.touch.active.is_some()
            || self.drag_on
            || self.tow_origin.is_some()
            || self.motion.touch.bonking()
            || self.motion.touch.dip.active
    }
    /// One step of the frame loop: advance her and draw into `frame` (window device px).
    pub fn frame(&mut self, now: f64, frame: &mut Frame) {
        let dt = (now - self.last).clamp(0.0, 0.1);
        self.last = now;
        if let Some(t) = self.chat_at {
            if now >= t {
                self.chat_at = None;
                if !self.busy_for_chat() {
                    self.effects.push(Effect::Chat);
                }
            }
        }
        let s = self.l.s;
        let (cx, cy) = (self.pos.0 + s / 2.0, self.pos.1 + s / 2.0);
        let fresh = self.pointer.filter(|_| now - self.pointer_at < 0.8);
        let near = fresh.is_some_and(|p| (p.x - cx).hypot(p.y - cy) < (NEAR_RATIO * s).max(NEAR_MIN));
        let follow = self.settings.follow;
        let (hx, hy) = match fresh {
            Some(p) => ((p.x - self.pos.0) / s, (p.y - self.pos.1) / s),
            None => (0.5, 0.5),
        };
        let active = self.touch.active.is_some();
        let over_head = fresh.is_some_and(|p| (!self.l.docked || p.y < self.l.ledge_y) && head_contact(p.x - self.pos.0, p.y - self.pos.1, s));
        let input = AttentionInput {
            now,
            reduced: self.settings.reduced,
            follow,
            inner_side: self.pointer.map_or(f64::NAN, |p| p.inner_side),
            x: fresh.map_or(f64::NAN, |p| p.x),
            y: fresh.map_or(f64::NAN, |p| p.y),
            size: s,
            near,
            over_head,
            hx: (hx - 0.5) / 0.3,
            hy: (hy - 0.46) / 0.23,
            blocked: active || self.motion.touch.bonking(),
            wake: self.wake_flag,
            poke: self.poke_flag || active,
        };
        let attention = self.motion.attention.update(dt, &input, &mut self.motion.wake);
        let hold = self.motion.blocks_travel();
        let out = self.peek.update(
            dt,
            &PeekInput {
                gx: match fresh {
                    Some(p) if follow && !active => p.gx * attention.gaze_weight,
                    _ => 0.0,
                },
                gy: match fresh {
                    Some(p) if follow => p.gy,
                    _ => 0.0,
                },
                near: !attention.sleeping && (attention.attentive || !follow),
                poke: !attention.sleeping && (self.poke_flag || active),
                docked: self.l.docked,
                reduced: self.settings.reduced,
                hold,
            },
        );
        self.poke_flag = false;
        self.wake_flag = false;
        self.motion.over = if follow { out.over } else { None };
        if let Some(g) = out.gesture {
            if !attention.rubbing
                && !attention.sleeping
                && !attention.woke
                && !self.motion.wake.active()
                && !self.motion.touch.bonking()
                && !attention.reluctant.active
            {
                self.motion.gesture(g);
            }
        }
        let cur = self.motion.step(dt);
        if cur.touch.tow_end.is_some_and(|e| e.traveled > 0.0) {
            let r = self.motion.touch.dip.remaining();
            self.motion.slump.arrive(r);
        }
        if let Some(o) = self.tow_origin {
            let tow = &self.motion.touch.tow;
            if tow.busy() {
                let x = (o + tow.offset).round();
                if Some(x) != self.tow_sent {
                    self.tow_sent = Some(x);
                    self.effects.push(Effect::Tow(x));
                }
            } else {
                self.tow_origin = None;
                self.tow_sent = None;
            }
        }
        self.out = Some(out);
        self.draw(cur, out, frame);
    }

    fn draw(&mut self, cur: Pose, out: PeekOut, frame: &mut Frame) {
        let l = self.l;
        let mut pose = cur;
        if l.docked {
            pose.roll += out.roll;
        }
        self.place(if l.docked { out.offset_x } else { 0.0 }, if l.docked { out.bob } else { 0.0 });
        let rect = self.canvas_rect();
        frame.resize((l.w * l.dpr).round() as usize, (l.h * l.dpr).round() as usize);
        frame.clear();
        let sink = if l.docked { (pose.touch.dip + 0.05 * pose.slump) * l.s } else { 0.0 };
        self.head_hands = if pose.touch.guard > 0.001 || pose.rub_eyes > 0.001 { hands::head_gesture(&mut self.renderer, &pose, rect, sink) } else { Vec::new() };
        self.renderer.prepare(&pose, rect);
        // Hands sit on top of the head: draw the head first into an empty frame, then the hands.
        let clip_h = if l.docked { (l.ledge_y * l.dpr).round() as i32 } else { frame.h as i32 };
        let target = Target { ox: rect.left * l.dpr, oy: rect.top * l.dpr, size: rect.width * l.dpr, clip: [0, 0, frame.w as i32, clip_h] };
        #[cfg(windows)]
        if let Some(g) = self.gpu.as_mut() {
            if let Err(e) = g.draw(&self.renderer, frame, &pose, target) {
                eprintln!("Direct3D 11 failed, drawing on the CPU from now on: {e}");
                self.gpu = None;
                frame.clear();
                self.renderer.raster(frame, &pose, target);
            }
        } else {
            self.renderer.raster(frame, &pose, target);
        }
        #[cfg(not(windows))]
        self.renderer.raster(frame, &pose, target);
        if l.docked {
            let mut alpha = [1.0, 1.0];
            for (i, h) in &self.head_hands {
                alpha[*i] *= 1.0 - h.alpha;
            }
            let lean = pose.slump * if pose.slump_side == self.wall.0 { pose.slump_side * self.slump_shift() } else { 0.0 };
            let mut rest = out.hands;
            if lean != 0.0 {
                for (i, h) in rest.iter_mut().enumerate() {
                    h.x += lean * if i == if lean < 0.0 { 0 } else { 1 } { 0.75 } else { 0.4 };
                }
            }
            self.resting_hands = hands::resting(l.w / 2.0, l.ledge_y, l.s, &rest, alpha);
            hands::draw(frame, &self.resting_hands, &self.skin, l.dpr, None);
            let head: Vec<HandDraw> = self.head_hands.iter().map(|h| h.1).collect();
            hands::draw(frame, &head, &self.skin, l.dpr, Some(l.ledge_y));
        } else {
            self.resting_hands = [HandDraw::default(); 2];
            let head: Vec<HandDraw> = self.head_hands.iter().map(|h| h.1).collect();
            hands::draw(frame, &head, &self.skin, l.dpr, None);
        }
    }

    /// Where the top of her head is (the chat bubble points there), window CSS px.
    pub fn head_top(&self) -> (f64, f64) {
        (self.pos.0 + self.l.s / 2.0, self.pos.1)
    }
}

impl Pet {
    /// A window CSS point on her (for automated tests): `"ahoge"` near its tip, or `"body"`: an
    /// opaque spot on the head that is no special part, closest to her face.
    pub fn find_point(&self, frame: &Frame, want: &str) -> Option<(f64, f64)> {
        let l = self.l;
        let s = l.s;
        let target = (self.pos.0 + s * 0.5, self.pos.1 + s * 0.55);
        let mut best: Option<(f64, (f64, f64))> = None;
        let mut y = (self.pos.1 - s * 0.3).max(0.0);
        let bottom = if l.docked { l.ledge_y - 4.0 } else { l.h };
        while y < bottom {
            let mut x = 0.0;
            while x < l.w {
                let alpha = frame.alpha((x * l.dpr) as usize, (y * l.dpr) as usize);
                if alpha > 200 && !self.on_hands(x, y) {
                    let hit = self.pick(x, y);
                    let ok = match want {
                        "ahoge" => hit.is_some_and(|h| h.part == "ahoge" && h.binding.is_some_and(|b| b.t > 40.0)),
                        _ => hit.is_none(),
                    };
                    if ok {
                        let d = (x - target.0).hypot(y - target.1);
                        if best.is_none_or(|b| d < b.0) {
                            best = Some((d, (x, y)));
                        }
                    }
                }
                x += 3.0;
            }
            y += 3.0;
        }
        best.map(|b| b.1)
    }
    pub fn is_sleeping(&self) -> bool {
        self.motion.attention.current.sleeping
    }
}
