//! touch.mjs: transient reactions to being touched (Touch) and the press/move/release router (TouchInput).
use super::ahoge::{ahoge_reach, bind_ahoge, Binding, Outline};
use super::small::{EarTwitch, Fringe};
use super::tow::{Dip, DipKind, Tow, TowEnd, TOW_DIP_AFTER, TOW_LIFT, TOW_WARN};
use crate::util::{clamp, finite_or_zero, smooth, Pt, Rand};

pub const BONK_CHANCE: f64 = 0.35;
const DOUBLE_TAP: f64 = 0.42;
const BONK_GUARD: f64 = 1.1;
/// How far a press on the fringe may travel (x head size) before it turns into carrying her.
pub const TOUCH_HANDOFF_HAIR: f64 = 0.12;

/// A pointer position: window-local `x, y` plus, when known, screen `sx, sy` (NaN otherwise).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub sx: f64,
    pub sy: f64,
}
impl Point {
    pub fn local(x: f64, y: f64) -> Self {
        Point { x, y, sx: f64::NAN, sy: f64::NAN }
    }
    pub fn new(x: f64, y: f64, sx: f64, sy: f64) -> Self {
        Point { x, y, sx, sy }
    }
    fn has_screen(&self) -> bool {
        self.sx.is_finite() && self.sy.is_finite()
    }
    pub fn xy(&self) -> Pt {
        Pt::new(self.x, self.y)
    }
}
fn motion_distance(a: &Point, b: &Point) -> f64 {
    if a.has_screen() && b.has_screen() {
        (a.sx - b.sx).hypot(a.sy - b.sy)
    } else {
        (a.x - b.x).hypot(a.y - b.y)
    }
}

/// What the renderer's pick found under the pointer, for grabbing the ahoge or the fringe.
#[derive(Clone, Copy, Debug)]
pub struct Grip {
    pub source: Pt,
    pub binding: Option<Binding>,
    pub outline: Option<Outline>,
    pub relative: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct Grab {
    pub source: Pt,
    pub binding: Option<Binding>,
    pub base_outline: Option<Outline>,
    pub relative: bool,
    pub client: Pt,
    pub held: bool,
    pub released_at: f64,
    pub strength: f64,
    pub slip: bool,
}
#[derive(Clone, Copy, Debug)]
struct Ear {
    at: f64,
    count: f64,
    amplitude: f64,
    period: f64,
}
#[derive(Clone, Copy, Debug, Default)]
struct Pull {
    x: f64,
    y: f64,
    pain: f64,
}

/// Everything Touch contributes to the pose (the JS spreads these keys into the frame).
#[derive(Clone, Copy, Debug, Default)]
pub struct TouchState {
    pub fringe_x: f64,
    pub fringe_y: f64,
    pub fringe_focus: f64,
    pub guard: f64,
    pub bonk: f64,
    pub pain: f64,
    pub ahoge_pull_x: f64,
    pub ahoge_pull_y: f64,
    pub ear_fold_l: f64,
    pub ear_fold_r: f64,
    pub towing: f64,
    pub tow_lean: f64,
    pub tow_wince: f64,
    pub tow_slip: f64,
    pub dip: f64,
    pub dip_mix: f64,
    pub dip_dir: f64,
    pub dip_kind: f64,
    pub ahoge_sway: f64,
    pub tow_end: Option<TowEnd>,
    pub ear_twitch_l: Option<EarTwitch>,
    pub ear_twitch_r: Option<EarTwitch>,
    pub ahoge_grab: Option<Grab>,
}

pub struct Touch {
    pub random: Rand,
    pub tow: Tow,
    pub dip: Dip,
    pub fringe: Fringe,
    tow_client: Option<Pt>,
    tow_lean: f64,
    tow_wince: f64,
    pub time: f64,
    pub anchor: Option<Pt>,
    target: Pull,
    value: Pull,
    ears: [Option<Ear>; 2],
    pub grab: Option<Grab>,
    idle_time: f64,
    pub head_tap: Option<(Point, f64)>,
    bonk_at: Option<f64>,
    tug_guard: f64,
    next_ear_at: f64,
    last_reduced: bool,
}
impl Touch {
    pub fn new(random: Rand) -> Self {
        let dip = Dip::new(random.clone());
        let mut t = Touch {
            random,
            tow: Tow::default(),
            dip,
            fringe: Fringe::default(),
            tow_client: None,
            tow_lean: 0.0,
            tow_wince: 0.0,
            time: 0.0,
            anchor: None,
            target: Pull::default(),
            value: Pull::default(),
            ears: [None, None],
            grab: None,
            idle_time: 0.0,
            head_tap: None,
            bonk_at: None,
            tug_guard: 0.0,
            next_ear_at: 0.0,
            last_reduced: false,
        };
        t.reset();
        t
    }
    pub fn reset(&mut self) {
        self.fringe = Fringe::default();
        self.tow.reset();
        self.dip.reset();
        self.tow_client = None;
        self.tow_lean = 0.0;
        self.tow_wince = 0.0;
        self.time = 0.0;
        self.anchor = None;
        self.target = Pull::default();
        self.value = Pull::default();
        self.ears = [None, None];
        self.grab = None;
        self.idle_time = 0.0;
        self.head_tap = None;
        self.bonk_at = None;
        self.tug_guard = 0.0;
        self.schedule_ear();
    }
    pub fn bonking(&self) -> bool {
        self.bonk_at.is_some()
    }
    pub fn start_bonk(&mut self) -> bool {
        if self.bonking() {
            return false;
        }
        self.bonk_at = Some(self.time);
        self.head_tap = None;
        self.dip.start(0.0, DipKind::Bonk);
        true
    }
    pub fn tap_head(&mut self, point: Point, size: f64) -> bool {
        if self.bonking() {
            return false;
        }
        let last = self.head_tap;
        self.head_tap = Some((point, self.time));
        let Some((lp, lt)) = last else { return false };
        if self.time - lt > DOUBLE_TAP || motion_distance(&point, &lp) > 12f64.max(size * 0.065) {
            return false;
        }
        self.head_tap = None;
        self.random.next() < BONK_CHANCE && self.start_bonk()
    }
    fn schedule_ear(&mut self) {
        self.next_ear_at = self.idle_time + 60.0 + self.random.next() * 60.0;
    }
    pub fn start_pull(&mut self, point: Point, grip: Option<&Grip>, tow: bool, size: f64) {
        self.anchor = Some(point.xy());
        self.target = Pull::default();
        self.tow_client = None;
        self.dip.cancel();
        let reach = grip.map(|g| ahoge_reach(&g.binding.unwrap_or_else(|| bind_ahoge(g.source))));
        if tow && point.has_screen() && self.tow.begin(Pt::new(point.sx, point.sy), size, reach) {
            self.tow_client = Some(point.xy());
        } else {
            self.tow.reset();
        }
        self.grab = grip.map(|g| Grab {
            source: g.source,
            binding: g.binding,
            base_outline: g.outline,
            relative: g.relative,
            client: point.xy(),
            held: true,
            released_at: 0.0,
            strength: 1.0,
            slip: false,
        });
        self.schedule_ear();
    }
    pub fn move_pull(&mut self, point: Point, size: f64) {
        if self.anchor.is_none() || !size.is_finite() || size <= 0.0 {
            return;
        }
        if self.tow.active {
            if point.has_screen() {
                self.tow.move_to(Pt::new(point.sx, point.sy));
            }
            return;
        }
        let a = self.anchor.unwrap();
        let x = (point.x - a.x) / size;
        let y = (point.y - a.y) / size;
        if !x.is_finite() || !y.is_finite() {
            return;
        }
        if let Some(g) = self.grab.as_mut() {
            g.client = point.xy();
        }
        self.target = Pull { x: clamp(x, -0.12, 0.12), y: clamp(y, -0.09, 0.12), pain: clamp((x.hypot(y) - 0.018) / 0.14, 0.0, 1.0) };
    }
    pub fn end_pull(&mut self) {
        if self.anchor.is_none() {
            return;
        }
        self.tow.release(self.last_reduced);
        self.anchor = None;
        self.target = Pull::default();
        if let Some(g) = self.grab.as_mut() {
            g.held = false;
            g.released_at = self.time;
        }
    }
    fn slip(&mut self) {
        if self.anchor.is_none() {
            return;
        }
        self.anchor = None;
        self.target = Pull::default();
        if let Some(g) = self.grab.as_mut() {
            g.held = false;
            g.released_at = self.time;
            g.slip = true;
        }
        for e in self.ears.iter_mut() {
            *e = Some(Ear { at: self.time, count: 1.0, amplitude: 0.7, period: 0.13 });
        }
    }
    /// `side`: 0 = left ear, 1 = right ear.
    pub fn twitch(&mut self, side: usize, idle: bool) -> f64 {
        let count = if self.random.next() < 0.5 { 1.0 } else { 2.0 };
        self.ears[side] = Some(Ear {
            at: self.time,
            count: if idle { 1.0 } else { count },
            amplitude: if idle { 0.38 } else { 1.0 },
            period: if idle { 0.16 } else { 0.115 },
        });
        if !idle {
            self.schedule_ear();
        }
        count
    }
    pub fn step(&mut self, dt: f64, reduced: bool, idle: bool) -> TouchState {
        let dt = clamp(finite_or_zero(dt), 0.0, 0.1);
        self.time += dt;
        self.last_reduced = reduced;
        let (mut tow_end, mut tow_slip, mut lean_target, mut wince_target) = (None, false, 0.0, 0.0);
        if self.tow.busy() || self.tow.pending_end.is_some() {
            let o = self.tow.step(dt, reduced);
            let size = self.tow.size;
            tow_end = o.ended;
            if let (Some(_), Some(tc)) = (self.anchor, self.tow_client) {
                self.target = Pull {
                    x: clamp(o.stretch / size, -0.16, 0.16),
                    y: clamp(o.dy / size, -0.2, 0.12),
                    pain: 0.85 * smooth((o.height - TOW_WARN) / (TOW_LIFT - TOW_WARN)),
                };
                if let Some(g) = self.grab.as_mut() {
                    g.client = Pt::new(tc.x + o.stretch, tc.y + o.dy);
                }
            }
            if o.slip {
                tow_slip = true;
                self.slip();
            }
            if o.engaged && (o.active || self.tow.gliding) {
                lean_target = clamp(o.velocity / (size * 3.0), -1.0, 1.0);
                if o.active {
                    wince_target = 0.3 + 0.7 * smooth(o.velocity.abs() / (size * 2.5));
                }
            } else if o.active {
                wince_target = 0.3 * smooth((o.ratio - 0.9) / 0.14);
            }
        }
        if let Some(e) = tow_end.filter(|e| e.traveled >= TOW_DIP_AFTER) {
            self.dip.start(e.dir, DipKind::Tow);
        }
        let follow = 1.0 - (-dt * if reduced { 20.0 } else { 8.0 }).exp();
        self.tow_lean += (lean_target - self.tow_lean) * follow;
        self.tow_wince += (wince_target - self.tow_wince) * follow;
        if self.tow_lean.abs() < 1e-3 && lean_target == 0.0 {
            self.tow_lean = 0.0;
        }
        if self.tow_wince < 1e-3 && wince_target == 0.0 {
            self.tow_wince = 0.0;
        }
        if idle && !reduced && self.anchor.is_none() && !self.fringe.held {
            self.idle_time += dt;
            if self.idle_time >= self.next_ear_at && self.ears[0].is_none() && self.ears[1].is_none() {
                let side = if self.random.next() < 0.5 { 0 } else { 1 };
                self.twitch(side, true);
                self.schedule_ear();
            }
        }
        if let Some(g) = self.grab.as_mut().filter(|g| !g.held) {
            let t = self.time - g.released_at;
            let slip = g.slip;
            let (k, w) = if slip { (6.5, 19.0) } else { (11.0, 17.0) };
            g.strength = if reduced { (-t * 18.0).exp() } else { (-t * k).exp() * ((t * w).cos() + 0.32 * (t * w).sin()) };
            if t >= if slip { 0.95 } else { 0.65 } {
                self.grab = None;
            }
        }
        let anchored = self.anchor.is_some();
        for (target, value) in [
            (self.target.x, &mut self.value.x),
            (self.target.y, &mut self.value.y),
            (self.target.pain, &mut self.value.pain),
        ] {
            *value += (target - *value) * (1.0 - (-dt * if anchored { 36.0 } else { 14.0 }).exp());
            if (target - *value).abs() < 0.0005 {
                *value = target;
            }
        }
        let fringe = self.fringe.step(dt, reduced);
        let fold_l = self.fold(0, reduced);
        let fold_r = self.fold(1, reduced);
        let guard_target = if anchored && self.tow_client.is_none() { smooth((self.value.pain - 0.03) / 0.32) } else { 0.0 };
        self.tug_guard += (guard_target - self.tug_guard) * (1.0 - (-dt * if anchored { 20.0 } else { 12.0 }).exp());
        if self.tug_guard < 0.001 {
            self.tug_guard = 0.0;
        }
        let bonk_age = self.bonk_at.map_or(f64::INFINITY, |b| self.time - b);
        if bonk_age >= BONK_GUARD && !self.dip.active {
            self.bonk_at = None;
        }
        let bonking = self.bonking();
        let guard = if bonking { smooth(bonk_age / 0.14) * (1.0 - smooth((bonk_age - 0.76) / 0.32)) } else { self.tug_guard };
        let pain = self.value.pain.max(if bonking { smooth(bonk_age / 0.08) * (1.0 - smooth((bonk_age - 0.74) / 0.27)) } else { 0.0 });
        let towing = if self.tow.engaged && self.tow.busy() { 1.0 } else { 0.0 };
        let dip = self.dip.step(dt, reduced);
        let twitch = |e: Option<Ear>| {
            e.filter(|_| !reduced)
                .map(|e| EarTwitch { elapsed: self.time - e.at, count: e.count, period: e.period, amplitude: e.amplitude })
        };
        TouchState {
            fringe_x: fringe.x,
            fringe_y: fringe.y,
            fringe_focus: fringe.focus,
            guard,
            bonk: if bonking { 1.0 } else { 0.0 },
            pain,
            ahoge_pull_x: self.value.x,
            ahoge_pull_y: self.value.y,
            ear_fold_l: fold_l,
            ear_fold_r: fold_r,
            towing,
            tow_lean: self.tow_lean,
            tow_wince: self.tow_wince,
            tow_slip: if tow_slip { 1.0 } else { 0.0 },
            dip: dip.dip,
            dip_mix: dip.dip_mix,
            dip_dir: dip.dip_dir,
            dip_kind: dip.dip_kind,
            ahoge_sway: dip.ahoge_sway,
            tow_end,
            ear_twitch_l: twitch(self.ears[0]),
            ear_twitch_r: twitch(self.ears[1]),
            ahoge_grab: self.grab,
        }
    }
    fn fold(&mut self, side: usize, reduced: bool) -> f64 {
        let Some(ear) = self.ears[side] else { return 0.0 };
        let elapsed = self.time - ear.at;
        let duration = if reduced { 0.22 } else { ear.count * ear.period + 0.045 };
        if elapsed >= duration {
            self.ears[side] = None;
            return 0.0;
        }
        if reduced {
            return 0.22 * (std::f64::consts::PI * elapsed / duration).sin();
        }
        if elapsed >= ear.count * ear.period {
            return 0.0;
        }
        let phase = elapsed % ear.period / ear.period;
        ear.amplitude * (std::f64::consts::PI * phase).sin().powi(2)
    }
}

// ---- TouchInput -----------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Part {
    Body,
    Ahoge,
    HairFront,
    EarL,
    EarR,
}
impl Part {
    pub fn name(self) -> &'static str {
        match self {
            Part::Body => "body",
            Part::Ahoge => "ahoge",
            Part::HairFront => "hair_front",
            Part::EarL => "ear_l",
            Part::EarR => "ear_r",
        }
    }
    fn is_ear(self) -> bool {
        matches!(self, Part::EarL | Part::EarR)
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Active {
    pub part: Part,
    pub point: Point,
    pub size: f64,
    pub head: bool,
    pub moved: bool,
    pub at: f64,
}
/// Routes one press. `drags` collects the JS `onDrag(on)` calls in order; the owner drains it.
#[derive(Default)]
pub struct TouchInput {
    pub active: Option<Active>,
    pub drags: Vec<bool>,
}
impl TouchInput {
    pub fn begin(&mut self, touch: &mut Touch, part: Option<Part>, point: Point, size: f64, grip: Option<&Grip>, head: bool, tow: bool) -> bool {
        if self.active.is_some() {
            return false;
        }
        self.active = Some(Active { part: part.unwrap_or(Part::Body), point, size, head, moved: false, at: touch.time });
        if !head {
            touch.head_tap = None;
        }
        match part {
            Some(Part::Ahoge) => touch.start_pull(point, grip, tow, size),
            Some(Part::HairFront) => touch.fringe.start(point.xy(), size, grip.map(|g| g.source)),
            Some(Part::EarL) | Some(Part::EarR) => {}
            _ => self.drags.push(true),
        }
        true
    }
    pub fn move_to(&mut self, touch: &mut Touch, point: Point) {
        let Some(active) = self.active.as_mut() else { return };
        if motion_distance(&point, &active.point) > 5f64.max(active.size * 0.025) {
            active.moved = true;
            touch.head_tap = None;
        }
        let d = (point.x - active.point.x).hypot(point.y - active.point.y);
        match active.part {
            Part::Ahoge => touch.move_pull(point, active.size),
            Part::HairFront => {
                if d > 16f64.max(active.size * TOUCH_HANDOFF_HAIR) {
                    touch.fringe.end();
                    touch.head_tap = None;
                    active.part = Part::Body;
                    active.moved = true;
                    self.drags.push(true);
                } else {
                    touch.fringe.move_to(point.xy());
                }
            }
            p if p.is_ear() && d > 5f64.max(active.size * 0.025) => {
                active.part = Part::Body;
                self.drags.push(true);
            }
            _ => {}
        }
    }
    pub fn hover(&mut self, touch: &mut Touch, part: Option<Part>, point: Option<Point>, size: f64, grip: Option<&Grip>) {
        let p = if self.active.is_none() && part == Some(Part::HairFront) { point.map(|p| p.xy()) } else { None };
        touch.fringe.brush(p, size, grip.map(|g| g.source));
    }
    /// Returns whether the release started a bonk.
    pub fn end(&mut self, touch: &mut Touch, cancel: bool) -> bool {
        let Some(active) = self.active.take() else { return false };
        match active.part {
            Part::Ahoge => touch.end_pull(),
            Part::HairFront => touch.fringe.end(),
            Part::EarL | Part::EarR => {
                if !cancel {
                    touch.twitch(if active.part == Part::EarL { 0 } else { 1 }, false);
                }
            }
            Part::Body => self.drags.push(false),
        }
        if cancel || active.moved || touch.time - active.at > 0.45 {
            touch.head_tap = None;
            return false;
        }
        active.head && touch.tap_head(active.point, active.size)
    }
}
