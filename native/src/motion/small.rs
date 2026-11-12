//! The small behaviour state machines, one per JS module:
//! eyes.mjs, fringe.mjs, ears.mjs, sleep.mjs, reluctance.mjs, eyelids.mjs, doze.mjs, wake.mjs, slump.mjs.
use crate::util::{clamp, finite_or_zero, rad, sign, smooth, Pt, Rand};

// ---- eyes.mjs -------------------------------------------------------------------------------
pub mod eye_style {
    pub const RADIUS: f64 = 64.0;
    pub const CURVE: f64 = 7.5;
    pub const STROKE: f64 = 15.0;
    pub const GLANCE_RADIUS: f64 = 34.0;
    pub const GLANCE_DEPTH: f64 = 0.52;
}
#[derive(Clone, Copy, Debug)]
pub struct EyeFrame {
    pub upper: f64,
    pub lower: f64,
    pub radius: f64,
    pub line: f64,
    pub iris: f64,
    pub corner: f64,
    pub curve: f64,
    pub side_eye: f64,
    pub gaze_span: f64,
}
pub fn eye_frame(openness: f64, side_eye: f64) -> EyeFrame {
    let o = clamp(openness, 0.0, 1.0);
    let m = clamp(side_eye, 0.0, 1.0);
    EyeFrame {
        upper: 1.12 * smooth((o - 0.5) / 0.5),
        lower: 1.12 * smooth(o / 0.5) * (1.0 - 0.45 * m),
        radius: eye_style::RADIUS + 12.0 * smooth(o),
        line: 1.0 - smooth((o - 0.6) / 0.35),
        iris: smooth(o / 0.06),
        corner: 1.0 - smooth((o - 0.5) / 0.4),
        curve: eye_style::CURVE * (1.0 - 0.9 * m),
        side_eye: m,
        gaze_span: 0.009 + 0.0075 * m,
    }
}

// ---- fringe.mjs -----------------------------------------------------------------------------
pub const FRINGE_PULL_X: f64 = 0.018;
pub const FRINGE_PULL_Y: f64 = 0.008;
pub const FRINGE_BRUSH_X: f64 = 0.008;
pub const FRINGE_BRUSH_Y: f64 = 0.003;
#[derive(Clone, Debug)]
pub struct Fringe {
    pub time: f64,
    pub held: bool,
    anchor: Option<(f64, f64, f64)>,
    last_brush: Option<(f64, f64, f64)>,
    brush_until: f64,
    pub focus: f64,
    target: Pt,
    value: Pt,
    velocity: Pt,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct FringeOut {
    pub x: f64,
    pub y: f64,
    pub focus: f64,
}
impl Default for Fringe {
    fn default() -> Self {
        Fringe {
            time: 0.0,
            held: false,
            anchor: None,
            last_brush: None,
            brush_until: 0.0,
            focus: 0.5,
            target: Pt::default(),
            value: Pt::default(),
            velocity: Pt::default(),
        }
    }
}
impl Fringe {
    pub fn start(&mut self, point: Pt, size: f64, source: Option<Pt>) {
        self.held = true;
        self.anchor = Some((point.x, point.y, size));
        self.last_brush = None;
        self.focus = clamp(source.map_or(1024.0, |s| s.x) / 2048.0, 0.0, 1.0);
        self.target = Pt::default();
    }
    pub fn move_to(&mut self, point: Pt) {
        if !self.held {
            return;
        }
        let Some((ax, ay, size)) = self.anchor else { return };
        if !(point.x.is_finite() && point.y.is_finite() && size.is_finite()) || size <= 0.0 {
            return;
        }
        self.target = Pt::new(
            clamp((point.x - ax) / size * 0.3, -FRINGE_PULL_X, FRINGE_PULL_X),
            clamp((point.y - ay) / size * 0.25, -FRINGE_PULL_Y, FRINGE_PULL_Y),
        );
    }
    pub fn end(&mut self) {
        self.held = false;
        self.anchor = None;
        self.last_brush = None;
        self.target = Pt::default();
        self.brush_until = 0.0;
    }
    pub fn brush(&mut self, point: Option<Pt>, size: f64, source: Option<Pt>) {
        if self.held {
            return;
        }
        let point = match point {
            Some(p) if p.x.is_finite() && p.y.is_finite() && size.is_finite() && size > 0.0 => p,
            _ => {
                self.last_brush = None;
                self.target = Pt::default();
                return;
            }
        };
        let previous = self.last_brush;
        self.last_brush = Some((point.x, point.y, self.time));
        let Some((px, py, pt)) = previous else { return };
        if self.time - pt > 0.2 {
            return;
        }
        let dx = (point.x - px) / size;
        let dy = (point.y - py) / size;
        if dx.hypot(dy) < 0.001 {
            return;
        }
        self.focus = clamp(source.map_or(1024.0, |s| s.x) / 2048.0, 0.0, 1.0);
        self.target = Pt::new(
            clamp(self.target.x * 0.4 + dx * 0.25, -FRINGE_BRUSH_X, FRINGE_BRUSH_X),
            clamp(self.target.y * 0.4 + dy * 0.18, -FRINGE_BRUSH_Y, FRINGE_BRUSH_Y),
        );
        self.brush_until = self.time + 0.1;
    }
    pub fn step(&mut self, dt: f64, reduced: bool) -> FringeOut {
        let dt = clamp(finite_or_zero(dt), 0.0, 0.1);
        self.time += dt;
        if !self.held && self.time > self.brush_until {
            self.target = Pt::default();
        }
        let w = if self.held { 14.0 } else { 9.0 };
        let scale = if reduced { 0.25 } else { 1.0 };
        let e = (-w * dt).exp();
        for key in 0..2 {
            let (target, value, velocity, pull) = if key == 0 {
                (self.target.x, &mut self.value.x, &mut self.velocity.x, FRINGE_PULL_X)
            } else {
                (self.target.y, &mut self.value.y, &mut self.velocity.y, FRINGE_PULL_Y)
            };
            let target = target * scale;
            let x = *value - target;
            let c = *velocity + w * x;
            *value = target + (x + c * dt) * e;
            *velocity = (*velocity - w * c * dt) * e;
            let limit = pull * scale;
            if value.abs() > limit {
                *value = clamp(*value, -limit, limit);
                *velocity = 0.0;
            }
            if value.abs() < 1e-6 && velocity.abs() < 1e-5 {
                *value = 0.0;
                *velocity = 0.0;
            }
        }
        FringeOut { x: self.value.x, y: self.value.y, focus: self.focus }
    }
}
pub fn deform_fringe(px: f64, py: f64, fx: f64, fy: f64, focus: f64) -> (f64, f64) {
    let tip = smooth((py - 650.0) / 850.0);
    let spread = 0.25 + 0.75 * (-((px / 2048.0 - focus) / 0.20).powi(2)).exp();
    let weight = tip * spread;
    (px + fx * 2048.0 * weight, py + fy * 2048.0 * weight)
}

// ---- ears.mjs -------------------------------------------------------------------------------
/// An ear flick in progress (touch twitch or a dream twitch).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EarTwitch {
    pub elapsed: f64,
    pub count: f64,
    pub period: f64,
    pub amplitude: f64,
}
pub fn flick(t: f64, ear: &EarTwitch) -> f64 {
    if t < 0.0 || t >= ear.count * ear.period {
        return 0.0;
    }
    let cycle = (t / ear.period).floor();
    let u = t / ear.period - cycle;
    let wave = (u * std::f64::consts::PI * 2.0).sin() * (u * std::f64::consts::PI).sin();
    wave * if wave < 0.0 { 0.42 } else { 1.0 } * ear.amplitude * if cycle != 0.0 { 0.78 } else { 1.0 }
}
/// The pose values one ear reads.
#[derive(Clone, Copy, Debug, Default)]
pub struct EarInput {
    pub sleep: f64,
    pub mood: f64,
    pub twitch: Option<EarTwitch>,
    pub fold: f64,
    pub press: f64,
}
/// `left`: ear_l (side -1). pivot/box from the rig layer.
pub fn deform_ear(x: f64, y: f64, left: bool, pivot: [f64; 2], bx: [f64; 4], s: &EarInput) -> (f64, f64) {
    let side = if left { -1.0 } else { 1.0 };
    let (dx, dy) = (x - pivot[0], y - pivot[1]);
    let width = bx[2] - bx[0];
    let u = clamp(side * dx / (width * 0.55), 0.0, 1.0);
    let weight = u * u * (3.0 - 2.0 * u);
    let sleep = clamp(s.sleep, 0.0, 1.0);
    let mood = clamp(s.mood, -1.0, 1.0);
    let legacy = clamp(s.fold, 0.0, 1.0);
    let press = clamp(s.press, 0.0, 1.0);
    let base = 38.0 * (-mood).max(0.0) - 8.0 * mood.max(0.0) + 16.0 * sleep;
    if base == 0.0 && s.twitch.is_none() && legacy == 0.0 && press == 0.0 {
        return (x, y);
    }
    let a = rad(side * base * weight);
    let px = a.cos() * dx - a.sin() * dy;
    let py = a.sin() * dx + a.cos() * dy + sleep * width * 0.035 * weight;
    let root_wave = s.twitch.map_or(legacy, |e| flick(e.elapsed, &e));
    let tip_wave = s.twitch.map_or(legacy, |e| flick(e.elapsed - u * 0.035, &e));
    let a = rad(-side * (5.0 * root_wave * (u * 4.0).min(1.0) + 13.0 * tip_wave * u.powf(1.35)));
    let xx = a.cos() * px - a.sin() * py;
    let yy = a.sin() * px + a.cos() * py;
    let (axis_x, axis_y) = (side, -0.35);
    let len = axis_x.hypot(axis_y);
    let (ex, ey) = (axis_x / len, axis_y / len);
    let along = (xx * ex + yy * ey) * (1.0 - 0.04 * u * tip_wave.max(0.0));
    let cross = -xx * ey + yy * ex;
    let twist = rad(26.0 * tip_wave * u);
    let bend = -side * width * 0.055 * tip_wave * u * u;
    let narrow = cross * twist.cos() + bend;
    let mut fx = along * ex - narrow * ey;
    let mut fy = along * ey + narrow * ex;
    if press != 0.0 {
        let k = press * weight;
        let r = rad(-side * 24.0 * k);
        let rx = r.cos() * fx - r.sin() * fy;
        let ry = r.sin() * fx + r.cos() * fy;
        fx = rx * (1.0 - 0.42 * k);
        fy = ry * (1.0 + 0.12 * k) - (bx[3] - bx[1]) * 0.04 * k;
    }
    (pivot[0] + fx, pivot[1] + fy)
}

// ---- sleep.mjs ------------------------------------------------------------------------------
pub const SLEEP_EARLIEST: f64 = 120.0;
pub const SLEEP_LATEST: f64 = 600.0;
pub const SLEEP_CHANCE_AT_START: f64 = 0.1;
#[derive(Clone, Copy, Debug, Default)]
pub struct SleepState {
    pub sleeping: bool,
    pub closure: f64,
    pub depth: f64,
    pub wake_id: u32,
    pub woke: bool,
}
pub struct Sleep {
    pub random: Rand,
    pub wake_id: u32,
    time: f64,
    deadline: Option<f64>,
    pub sleeping: bool,
    pub closure: f64,
    pub depth: f64,
    open_at: Option<f64>,
}
pub struct SleepInput {
    pub idle_for: f64,
    pub active: bool,
    pub wake: bool,
    pub eligible: bool,
    pub reduced: bool,
}
impl Sleep {
    pub fn new(random: Rand) -> Self {
        Sleep { random, wake_id: 0, time: 0.0, deadline: None, sleeping: false, closure: 0.0, depth: 0.0, open_at: None }
    }
    pub fn reset(&mut self) {
        self.wake_id = 0;
        self.time = 0.0;
        self.deadline = None;
        self.sleeping = false;
        self.closure = 0.0;
        self.depth = 0.0;
        self.open_at = None;
    }
    pub fn update(&mut self, dt: f64, i: &SleepInput) -> SleepState {
        let dt = clamp(finite_or_zero(dt), 0.0, 0.1);
        self.time += dt;
        let woke = i.wake && self.sleeping;
        if i.wake {
            self.deadline = None;
            if woke {
                self.sleeping = false;
                self.open_at = None;
                self.wake_id += 1;
            }
        } else if i.active && !self.sleeping {
            self.deadline = None;
        } else if !self.sleeping && i.eligible {
            if i.idle_for >= SLEEP_EARLIEST && self.deadline.is_none() {
                let draw = clamp(self.random.next(), 0.0, 1.0);
                self.deadline = Some(
                    SLEEP_EARLIEST
                        + (SLEEP_LATEST - SLEEP_EARLIEST) * ((draw - SLEEP_CHANCE_AT_START) / (1.0 - SLEEP_CHANCE_AT_START)).max(0.0),
                );
            }
            if i.idle_for >= SLEEP_LATEST || self.deadline.is_some_and(|d| i.idle_for >= d) {
                self.sleeping = true;
                self.open_at = None;
            }
        }
        let ease = |a: f64, b: f64, rate: f64| a + (b - a) * (1.0 - (-dt * rate).exp());
        let target = if self.sleeping { 1.0 } else { 0.0 };
        self.closure = if i.reduced { target } else { ease(self.closure, target, if self.sleeping { 2.5 } else { 4.5 }) };
        if self.closure < 0.001 {
            self.closure = 0.0;
        } else if self.closure > 0.999 {
            self.closure = 1.0;
        }
        if self.sleeping {
            self.depth = if i.reduced { 1.0 } else { ease(self.depth, 1.0, 1.8) };
        } else if self.closure == 0.0 {
            let open_at = *self.open_at.get_or_insert(self.time);
            if self.time - open_at >= 0.1 {
                self.depth = if i.reduced { 0.0 } else { ease(self.depth, 0.0, 2.4) };
            }
        } else {
            self.open_at = None;
        }
        if self.depth < 0.001 {
            self.depth = 0.0;
        } else if self.depth > 0.999 {
            self.depth = 1.0;
        }
        SleepState { sleeping: self.sleeping, closure: self.closure, depth: self.depth, wake_id: self.wake_id, woke }
    }
}

// ---- reluctance.mjs -------------------------------------------------------------------------
pub const RELUCTANCE_CHANCE: f64 = 0.30;
pub const RELUCTANCE_DURATION: f64 = 3.6;
pub const RELUCTANCE_COOLDOWN: f64 = 30.0;
pub const RELUCTANCE_MIN_DROOP: f64 = 0.85;
pub const RELUCTANCE_SHIFT: f64 = 0.025;
#[derive(Clone, Copy, Debug, Default)]
pub struct ReluctanceSample {
    pub active: bool,
    pub mix: f64,
    pub gx: f64,
    pub yaw: f64,
    pub roll: f64,
    pub shift_x: f64,
    pub eye_cap: f64,
}
pub struct Reluctance {
    pub random: Rand,
    time: f64,
    armed: bool,
    elapsed: Option<f64>,
    next_at: f64,
    direction: f64,
}
pub struct ReluctanceInput {
    pub droop: f64,
    pub active: bool,
    pub eligible: bool,
    pub enabled: bool,
    pub hx: f64,
    pub inner_side: f64,
}
impl Reluctance {
    pub fn new(random: Rand) -> Self {
        Reluctance { random, time: 0.0, armed: false, elapsed: None, next_at: 0.0, direction: -1.0 }
    }
    pub fn reset(&mut self) {
        self.time = 0.0;
        self.armed = false;
        self.elapsed = None;
        self.next_at = 0.0;
        self.direction = -1.0;
    }
    pub fn active(&self) -> bool {
        self.elapsed.is_some()
    }
    pub fn update(&mut self, dt: f64, i: &ReluctanceInput) -> ReluctanceSample {
        let dt = clamp(finite_or_zero(dt), 0.0, 0.1);
        self.time += dt;
        if !i.eligible || !i.enabled {
            self.elapsed = None;
            self.armed = false;
            return self.sample();
        }
        if !self.active() && i.droop >= RELUCTANCE_MIN_DROOP && !i.active && self.time >= self.next_at {
            self.armed = true;
        }
        if !self.active() && self.armed && i.active {
            self.armed = false;
            self.next_at = self.time + RELUCTANCE_COOLDOWN;
            if self.random.next() < RELUCTANCE_CHANCE {
                // `Math.sign(innerSide)||-1`: innerSide may be missing (NaN) or 0.
                let inner = sign(i.inner_side);
                self.direction = if i.hx.abs() > 0.12 {
                    -sign(i.hx)
                } else if inner.is_nan() || inner == 0.0 {
                    -1.0
                } else {
                    inner
                };
                self.elapsed = Some(0.0);
            }
        }
        if let Some(e) = self.elapsed.as_mut() {
            *e += dt;
            if *e >= RELUCTANCE_DURATION {
                self.elapsed = None;
            }
        }
        self.sample()
    }
    pub fn sample(&self) -> ReluctanceSample {
        let t = self.elapsed.unwrap_or(0.0);
        let active = self.active();
        let mix = if active { smooth(t / 0.4) * (1.0 - smooth((t - 2.6) / 0.8)) } else { 0.0 };
        let shift = if active { smooth((t - 0.35) / 0.65) * (1.0 - smooth((t - 2.85) / 0.75)) } else { 0.0 };
        ReluctanceSample {
            active,
            mix,
            gx: self.direction * 0.95,
            yaw: self.direction * 3.5 * mix,
            roll: self.direction * 0.6 * mix,
            shift_x: if shift != 0.0 { self.direction * RELUCTANCE_SHIFT * shift } else { 0.0 },
            eye_cap: 1.0 - 0.5 * mix,
        }
    }
}

// ---- eyelids.mjs ----------------------------------------------------------------------------
fn openness(t: f64) -> f64 {
    if t < 0.0 || t >= 0.32 {
        return 1.0;
    }
    use std::f64::consts::FRAC_PI_2;
    if t < 0.13 {
        1.0 - (t / 0.13 * FRAC_PI_2).sin()
    } else {
        ((t - 0.13) / 0.19 * FRAC_PI_2).sin()
    }
}
pub struct Eyelids {
    pub random: Rand,
    blink_at: f64,
    blink_lead_left: bool,
    blink_lag: f64,
    rub_lead_left: bool,
    rub_lag: f64,
    rubbing: bool,
    history: Vec<(f64, f64)>,
}
impl Eyelids {
    pub fn new(random: Rand) -> Self {
        let mut e = Eyelids {
            random,
            blink_at: f64::NEG_INFINITY,
            blink_lead_left: true,
            blink_lag: 0.0,
            rub_lead_left: true,
            rub_lag: 0.0,
            rubbing: false,
            history: Vec::new(),
        };
        e.reset();
        e
    }
    pub fn reset(&mut self) {
        self.blink_at = f64::NEG_INFINITY;
        self.blink_lead_left = true;
        self.blink_lag = 0.0;
        self.rub_lead_left = true;
        self.rub_lag = 0.0;
        self.rubbing = false;
        self.history = vec![(f64::NEG_INFINITY, 1.0)];
    }
    fn timing(&mut self, min: f64, max: f64) -> (bool, f64) {
        if self.random.next() < 0.8 {
            return (true, 0.0);
        }
        let lead = self.random.next() < 0.5;
        (lead, min + self.random.next() * (max - min))
    }
    pub fn blink(&mut self, time: f64) {
        let (lead, lag) = self.timing(0.010, 0.025);
        self.blink_at = time;
        self.blink_lead_left = lead;
        self.blink_lag = lag;
    }
    pub fn sample(&mut self, time: f64, rub: f64, eye_cap: f64) -> (f64, f64) {
        let rubbing = rub > 0.1;
        if rubbing && !self.rubbing {
            let (lead, lag) = self.timing(0.025, 0.065);
            self.rub_lead_left = lead;
            self.rub_lag = lag;
        }
        self.rubbing = rubbing;
        let cap = if eye_cap.is_finite() { clamp(eye_cap, 0.0, 1.0) } else { 1.0 };
        let last = self.history.last_mut().unwrap();
        if last.0 == time {
            last.1 = cap;
        } else {
            self.history.push((time, cap));
        }
        while self.history.len() > 2 && self.history[1].0 < time - 0.6 {
            self.history.remove(0);
        }
        let delayed = |at: f64| {
            for i in 1..self.history.len() {
                let (a, b) = (self.history[i - 1], self.history[i]);
                if at <= b.0 {
                    if !a.0.is_finite() {
                        return a.1;
                    }
                    return a.1 + (b.1 - a.1) * clamp((at - a.0) / (b.0 - a.0), 0.0, 1.0);
                }
            }
            cap
        };
        let eye = |left: bool| {
            let blink = openness(time - self.blink_at - if left == self.blink_lead_left { 0.0 } else { self.blink_lag });
            let close = if rubbing && left != self.rub_lead_left { cap.max(delayed(time - self.rub_lag)) } else { cap };
            blink.min(close)
        };
        (eye(true), eye(false))
    }
}

// ---- doze.mjs -------------------------------------------------------------------------------
const DOZE_FIRST_EAR: [f64; 2] = [20.0, 40.0];
const DOZE_EAR_EVERY: [f64; 2] = [150.0, 300.0];
const DOZE_FIRST_SIDE: [f64; 2] = [35.0, 65.0];
const DOZE_SIDE_EVERY: [f64; 2] = [80.0, 240.0];
const DOZE_BREATH_AMPLITUDE: f64 = 0.0024;
#[derive(Clone, Copy, Debug)]
pub struct DozeEar {
    pub left: bool,
    pub at: f64,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct DozeOut {
    pub side: Option<f64>,
    pub breath: f64,
    pub wag: f64,
    pub ear: Option<(bool, EarTwitch)>,
}
pub struct Doze {
    pub random: Rand,
    active: bool,
    time: f64,
    last_clock: Option<f64>,
    ear: Option<DozeEar>,
    pub side: f64,
    pub side_target: f64,
    pub lean: f64,
    pub next_ear: f64,
    pub next_side: f64,
    pub breath_period: f64,
    pub sway_period: f64,
}
impl Doze {
    pub fn new(random: Rand) -> Self {
        Doze {
            random,
            active: false,
            time: 0.0,
            last_clock: None,
            ear: None,
            side: 0.0,
            side_target: 0.0,
            lean: 1.0,
            next_ear: 0.0,
            next_side: 0.0,
            breath_period: 0.0,
            sway_period: 0.0,
        }
    }
    pub fn reset(&mut self) {
        self.active = false;
        self.time = 0.0;
        self.last_clock = None;
        self.ear = None;
        self.side = 0.0;
        self.side_target = 0.0;
        self.lean = 1.0;
    }
    fn interval(&self, r: [f64; 2]) -> f64 {
        r[0] + self.random.next() * (r[1] - r[0])
    }
    pub fn twitch(&mut self, left: bool, dt: f64) {
        self.ear = Some(DozeEar { left, at: self.time - 0.025f64.min(dt / 2.0) });
    }
    pub fn step(&mut self, dt: f64, sleeping: bool, reduced: bool, now: Option<f64>) -> DozeOut {
        let zero = DozeOut::default();
        if !sleeping {
            self.reset();
            return zero;
        }
        let dt = clamp(finite_or_zero(dt), 0.0, 0.1);
        let clock = now.filter(|c| c.is_finite());
        let advance = match (clock, self.last_clock) {
            (Some(c), Some(l)) => (c - l).max(0.0),
            _ => dt,
        };
        self.last_clock = clock;
        if reduced {
            self.ear = None;
            return zero;
        }
        if !self.active {
            self.active = true;
            self.next_ear = self.interval(DOZE_FIRST_EAR);
            self.next_side = self.interval(DOZE_FIRST_SIDE);
            self.breath_period = 20.0 + self.random.next() * 8.0;
            self.sway_period = 35.0 + self.random.next() * 25.0;
        }
        self.time += advance;
        if self.time >= self.next_ear {
            let left = self.random.next() < 0.5;
            self.twitch(left, dt);
            self.next_ear = self.time + self.interval(DOZE_EAR_EVERY);
        }
        if self.time >= self.next_side {
            self.side_target = if self.side_target != 0.0 { -self.side_target } else { -self.lean };
            self.next_side = self.time + self.interval(DOZE_SIDE_EVERY);
        }
        self.side += (self.side_target - self.side) * (1.0 - (-dt * 0.3).exp());
        let lean_target = if self.side_target != 0.0 { self.side_target } else { 1.0 };
        self.lean += (lean_target - self.lean) * (1.0 - (-dt * 0.65).exp());
        if self.ear.is_some_and(|e| self.time - e.at > 0.2) {
            self.ear = None;
        }
        use std::f64::consts::PI;
        DozeOut {
            side: Some(self.lean),
            breath: (self.time / self.breath_period * PI * 2.0).sin() * DOZE_BREATH_AMPLITUDE,
            wag: self.side * 3.8 + (self.time / self.sway_period * PI * 2.0).sin() * 0.65,
            ear: self.ear.map(|e| (e.left, EarTwitch { elapsed: self.time - e.at, count: 1.0, period: 0.12, amplitude: 0.7 })),
        }
    }
}

// ---- wake.mjs -------------------------------------------------------------------------------
pub const WAKE_NORMAL: f64 = 0.6;
pub const WAKE_RUB: f64 = 0.25;
pub const WAKE_PEEK_DURATION: f64 = 2.4;
pub const WAKE_RETRY_WINDOW: f64 = 15.0;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WakePreset {
    Gentle,
    Stretch,
    Lookaround,
    Rubeyes,
    Peek,
}
impl WakePreset {
    pub fn name(self) -> &'static str {
        match self {
            WakePreset::Gentle => "gentle",
            WakePreset::Stretch => "stretch",
            WakePreset::Lookaround => "lookaround",
            WakePreset::Rubeyes => "rubeyes",
            WakePreset::Peek => "peek",
        }
    }
}
#[derive(Clone, Copy, Debug, Default)]
pub struct WakePose {
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub gx: f64,
    pub wag: f64,
    pub ears: f64,
    pub peek_eye: f64,
    pub peek_ear: f64,
    pub eye_cap: Option<f64>,
    pub rub_eyes: f64,
    pub rub_hand: Option<f64>,
    pub rub_phase: f64,
    pub rub_lift: f64,
}
pub struct Wake {
    pub random: Rand,
    pub preset: Option<WakePreset>,
    elapsed: f64,
    started: bool,
    protect_until: f64,
    request_at: f64,
    next_rub_hand: Option<u8>,
    rub_hand: u8,
}
impl Wake {
    pub fn new(random: Rand) -> Self {
        let mut w = Wake {
            random,
            preset: None,
            elapsed: 0.0,
            started: false,
            protect_until: f64::NEG_INFINITY,
            request_at: 0.0,
            next_rub_hand: None,
            rub_hand: 0,
        };
        w.reset();
        w
    }
    pub fn reset(&mut self) {
        self.finish();
        self.protect_until = f64::NEG_INFINITY;
        self.request_at = 0.0;
    }
    pub fn finish(&mut self) {
        self.preset = None;
        self.elapsed = 0.0;
        self.started = false;
    }
    pub fn active(&self) -> bool {
        self.preset.is_some()
    }
    pub fn pick(&mut self, protected_wake: bool) -> WakePreset {
        let raw = self.random.next();
        let raw = if raw.is_finite() { raw } else { 0.0 };
        let draw = raw.min(1.0 - f64::EPSILON).max(0.0) * if protected_wake { WAKE_NORMAL + WAKE_RUB } else { 1.0 };
        self.next_rub_hand = Some(if draw < WAKE_NORMAL + WAKE_RUB * 0.5 { 0 } else { 1 });
        if draw < WAKE_NORMAL * 0.5 {
            WakePreset::Gentle
        } else if draw < WAKE_NORMAL * 0.8 {
            WakePreset::Stretch
        } else if draw < WAKE_NORMAL {
            WakePreset::Lookaround
        } else if draw < WAKE_NORMAL + WAKE_RUB {
            WakePreset::Rubeyes
        } else {
            WakePreset::Peek
        }
    }
    /// `start(preset)` with the default hand (the last picked one).
    pub fn start(&mut self, preset: WakePreset) {
        let hand = self.next_rub_hand.unwrap_or(0);
        self.preset = Some(preset);
        self.rub_hand = if hand == 1 { 1 } else { 0 };
        self.elapsed = 0.0;
        self.started = false;
    }
    pub fn request(&mut self, now: f64) -> bool {
        let protected_wake = self.preset == Some(WakePreset::Peek) || now <= self.protect_until;
        self.request_at = now;
        let p = self.pick(protected_wake);
        self.start(p);
        if self.preset == Some(WakePreset::Peek) {
            self.protect_until = now + WAKE_PEEK_DURATION + WAKE_RETRY_WINDOW;
            return false;
        }
        true
    }
    pub fn step(&mut self, dt: f64, eyes_open: bool, reduced: bool, clock: Option<f64>) -> WakePose {
        use std::f64::consts::PI;
        let zero = WakePose::default();
        let Some(preset) = self.preset else { return zero };
        if !self.started {
            if !eyes_open && preset != WakePreset::Rubeyes && preset != WakePreset::Peek {
                return zero;
            }
            self.started = true;
        }
        self.elapsed += clamp(finite_or_zero(dt), 0.0, 0.1);
        let duration = match preset {
            WakePreset::Peek => {
                if reduced {
                    1.4
                } else {
                    WAKE_PEEK_DURATION
                }
            }
            _ if reduced => 0.35,
            WakePreset::Rubeyes => 5.2,
            WakePreset::Gentle => 2.2,
            WakePreset::Stretch => 2.8,
            WakePreset::Lookaround => 3.0,
        };
        let u = (self.elapsed / duration).min(1.0);
        let env = (PI * u).sin();
        if u >= 1.0 {
            if preset == WakePreset::Peek {
                self.protect_until = clock.filter(|c| c.is_finite()).unwrap_or(self.request_at + duration) + WAKE_RETRY_WINDOW;
            }
            self.finish();
            return zero;
        }
        if preset == WakePreset::Peek {
            let t = self.elapsed;
            let scale = if reduced { 1.4 / WAKE_PEEK_DURATION } else { 1.0 };
            let phase = t / scale;
            let ear = smooth(phase / 0.4) * (1.0 - smooth((phase - 1.35) / 0.9));
            let eye = smooth((phase - 0.25) / 0.45) * (1.0 - smooth((phase - 1.3) / 0.75));
            return WakePose { peek_eye: 0.22 * eye, peek_ear: ear * if reduced { 0.22 } else { 1.0 }, ..zero };
        }
        if reduced {
            return zero;
        }
        match preset {
            WakePreset::Rubeyes => {
                let t = self.elapsed;
                let hands = smooth((t - 1.25) / 0.8) * (1.0 - smooth((t - 3.15) / 0.7));
                WakePose {
                    pitch: -1.4 * env,
                    eye_cap: Some(smooth((t - 3.2) / 1.6)),
                    rub_eyes: hands,
                    rub_hand: Some(self.rub_hand as f64),
                    rub_phase: t * 18.0,
                    rub_lift: smooth((t - 1.3) / 0.8) * (1.0 - smooth((t - 4.7) / 0.5)) * 0.075,
                    ..zero
                }
            }
            WakePreset::Gentle => WakePose {
                pitch: -1.8 * env,
                roll: 0.8 * (u * PI * 2.0).sin() * env,
                wag: 3.0 * (u * PI * 4.0).sin() * env,
                ears: 0.12 * env,
                ..zero
            },
            WakePreset::Stretch => WakePose {
                pitch: -4.0 * env,
                roll: 2.0 * (u * PI * 2.0).sin() * env,
                wag: 8.0 * (u * PI * 6.0).sin() * env,
                ears: 0.45 * env,
                ..zero
            },
            _ => WakePose {
                yaw: 5.5 * (u * PI * 2.0).sin() * env,
                pitch: -0.8 * env,
                roll: 0.8 * (u * PI * 2.0).sin() * env,
                gx: 0.35 * (u * PI * 2.0).sin() * env,
                wag: 3.5 * (u * PI * 5.0).sin() * env,
                ears: 0.15 * env,
                ..zero
            },
        }
    }
}

// ---- slump.mjs ------------------------------------------------------------------------------
pub const SLUMP_ARRIVE_CHANCE: f64 = 0.5;
pub const SLUMP_ARRIVE_DELAY: [f64; 2] = [0.8, 1.5];
pub const SLUMP_IDLE_CHANCE: f64 = 0.3;
pub const SLUMP_IDLE_EVERY: [f64; 2] = [30.0, 60.0];
pub const SLUMP_IN: f64 = 1.2;
pub const SLUMP_HOLD: [f64; 2] = [6.0, 12.0];
pub const SLUMP_OUT: f64 = 0.9;
pub const SLUMP_QUICK: f64 = 0.35;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SlumpPhase {
    In,
    Hold,
    Out,
}
pub struct Slump {
    pub random: Rand,
    time: f64,
    phase: Option<SlumpPhase>,
    side: f64,
    t: f64,
    hold: f64,
    exit_from: f64,
    exit_length: f64,
    pending_at: Option<f64>,
    next_idle_at: Option<f64>,
    mix: f64,
}
impl Slump {
    pub fn new(random: Rand) -> Self {
        Slump {
            random,
            time: 0.0,
            phase: None,
            side: 0.0,
            t: 0.0,
            hold: 0.0,
            exit_from: 0.0,
            exit_length: SLUMP_OUT,
            pending_at: None,
            next_idle_at: None,
            mix: 0.0,
        }
    }
    pub fn reset(&mut self) {
        let r = self.random.clone();
        *self = Slump::new(r);
    }
    pub fn active(&self) -> bool {
        self.phase.is_some()
    }
    fn between(&self, [a, b]: [f64; 2]) -> f64 {
        a + (b - a) * clamp(self.random.next(), 0.0, 1.0)
    }
    pub fn arrive(&mut self, extra_delay: f64) {
        self.pending_at = Some(self.time + extra_delay.max(0.0) + self.between(SLUMP_ARRIVE_DELAY));
    }
    pub fn poke(&mut self) {
        self.pending_at = None;
        self.next_idle_at = None;
        self.leave(SLUMP_QUICK);
    }
    pub fn begin(&mut self, side: f64) {
        self.phase = Some(SlumpPhase::In);
        self.side = side;
        self.t = 0.0;
        self.hold = self.between(SLUMP_HOLD);
    }
    fn leave(&mut self, length: f64) {
        if matches!(self.phase, Some(p) if p != SlumpPhase::Out) {
            self.phase = Some(SlumpPhase::Out);
            self.exit_from = self.mix;
            self.exit_length = length;
            self.t = 0.0;
        }
    }
    /// Returns (slump, slumpSide).
    pub fn step(&mut self, dt: f64, wall: f64, enabled: bool, busy: bool) -> (f64, f64) {
        let dt = clamp(finite_or_zero(dt), 0.0, 0.1);
        self.time += dt;
        let wall = { let s = sign(wall); if s.is_nan() { 0.0 } else { s } };
        if !enabled {
            self.pending_at = None;
            self.next_idle_at = None;
            self.leave(SLUMP_QUICK);
        } else if matches!(self.phase, Some(p) if p != SlumpPhase::Out) && wall != self.side {
            self.leave(SLUMP_QUICK);
        } else if self.phase.is_none() && !busy {
            if let Some(at) = self.pending_at.filter(|&at| self.time >= at) {
                let _ = at;
                self.pending_at = None;
                self.next_idle_at = None;
                if wall != 0.0 && self.random.next() < SLUMP_ARRIVE_CHANCE {
                    self.begin(wall);
                }
            } else if self.pending_at.is_none() {
                if wall == 0.0 {
                    self.next_idle_at = None;
                } else if self.next_idle_at.is_none() {
                    self.next_idle_at = Some(self.time + self.between(SLUMP_IDLE_EVERY));
                } else if self.time >= self.next_idle_at.unwrap() {
                    self.next_idle_at = None;
                    if self.random.next() < SLUMP_IDLE_CHANCE {
                        self.begin(wall);
                    }
                }
            }
        }
        if busy && self.phase.is_none() {
            self.next_idle_at = None;
        }
        if let Some(phase) = self.phase {
            self.t += dt;
            match phase {
                SlumpPhase::In => {
                    self.mix = smooth(self.t / SLUMP_IN);
                    if self.t >= SLUMP_IN {
                        self.phase = Some(SlumpPhase::Hold);
                        self.t = 0.0;
                    }
                }
                SlumpPhase::Hold => {
                    self.mix = 1.0;
                    if self.t >= self.hold {
                        self.leave(SLUMP_OUT);
                    }
                }
                SlumpPhase::Out => {
                    self.mix = self.exit_from * (1.0 - smooth(self.t / self.exit_length));
                    if self.t >= self.exit_length {
                        self.phase = None;
                        self.mix = 0.0;
                        self.side = 0.0;
                    }
                }
            }
        }
        (self.mix, if self.mix > 0.0 { self.side } else { 0.0 })
    }
}
