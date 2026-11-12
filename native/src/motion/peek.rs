//! peek.mjs: peeking over the taskbar edge: shuffling sideways, going home, sulking; the idle hands.
use crate::util::{clamp, sign, smooth, Rand};

pub const GAZE_THRESHOLD: f64 = 0.4;
pub const GAZE_HOLD: f64 = 0.7;
pub const ATTENTIVE_WINDOW: f64 = 1.5;
pub const STEP_SIZE: f64 = 0.06;
pub const MAX_OFFSET: f64 = 0.12;
pub const COOLDOWN: f64 = 1.2;
pub const RETURN_COOLDOWN: f64 = 0.7;
pub const STEP_DURATION: f64 = 0.58;
pub const HEAD_MOVE_AT: f64 = 0.12;
pub const LIFT_HEIGHT: f64 = 0.025;
pub const HAND_ROTATION: f64 = 0.08;
pub const SQUASH_AMOUNT: f64 = 0.10;
pub const IGNORE_AFTER: f64 = 45.0;
pub const SULK_EXIT_NEAR: f64 = 0.6;
pub const SULK_YAW: f64 = 12.0;
pub const SULK_ROLL: f64 = 2.5;
pub const SULK_GY: f64 = 0.1;
pub const SULK_GX: f64 = 0.85;
pub const EYE_CAP: f64 = 0.55;
pub const FLIP_THRESHOLD: f64 = 0.25;
pub const HEAD_SPRING: f64 = 9.0;
pub const HEAD_ROLL: f64 = 2.8;
pub const HEAD_BOB: f64 = 0.012;
pub const MAX_SUB_STEP: f64 = 0.05;
pub const IDLE_SQUEEZE_HZ: [f64; 2] = [0.37, 0.29];
pub const TAP_EVERY: [f64; 2] = [4.0, 9.0];
pub const TAP_DURATION: f64 = 0.25;
pub const TAP_LAND: f64 = 0.12;
pub const RETURN_DROOP_FROM: f64 = 0.3;
pub const RETURN_DROOP_TO: f64 = 0.6;
pub const RETURN_DROOP_RAMP: f64 = 4.0;

fn ease_out(t: f64) -> f64 {
    let t = clamp(t, 0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}
fn ease_in(t: f64) -> f64 {
    let t = clamp(t, 0.0, 1.0);
    t * t * t
}
fn seg(u: f64, a: f64, b: f64) -> f64 {
    clamp((u - a) / (b - a), 0.0, 1.0)
}
struct Spring1 {
    value: f64,
    velocity: f64,
    w: f64,
}
impl Spring1 {
    fn step(&mut self, target: f64, dt: f64) {
        let x = self.value - target;
        let e = (-self.w * dt).exp();
        let c = self.velocity + self.w * x;
        self.value = target + (x + c * dt) * e;
        self.velocity = (self.velocity - self.w * c * dt) * e;
    }
}
struct Timeline {
    lift_up: [f64; 2],
    lift_down: [f64; 2],
    mv: [f64; 2],
    land: f64,
    settle: f64,
}
const LEAD: Timeline = Timeline { lift_up: [0.0, 0.14], lift_down: [0.26, 0.34], mv: [0.06, 0.26], land: 0.34, settle: 0.14 };
const TRAIL: Timeline = Timeline { lift_up: [0.22, 0.32], lift_down: [0.40, 0.48], mv: [0.28, 0.42], land: 0.48, settle: 0.10 };
struct HandPhase {
    lift: f64,
    mv: f64,
    rot: f64,
    squash: f64,
}
fn hand_phase(u: f64, t: &Timeline, rot_amount: f64, dir: f64) -> HandPhase {
    let rise = ease_out(seg(u, t.lift_up[0], t.lift_up[1]));
    let fall = ease_in(seg(u, t.lift_down[0], t.lift_down[1]));
    let lift = rise * (1.0 - fall);
    let mv = smooth(seg(u, t.mv[0], t.mv[1]));
    let sq = if u >= t.land {
        let k = seg(u, t.land, t.land + t.settle);
        (std::f64::consts::PI * k).sin() * SQUASH_AMOUNT * (1.0 - k * 0.3)
    } else {
        0.0
    };
    HandPhase { lift: lift * LIFT_HEIGHT, mv, rot: dir * rot_amount * lift, squash: sq }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Rest,
    Stepping,
    Returning,
    Sulk,
}
impl Mode {
    pub fn name(self) -> &'static str {
        match self {
            Mode::Rest => "rest",
            Mode::Stepping => "stepping",
            Mode::Returning => "returning",
            Mode::Sulk => "sulk",
        }
    }
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Hand {
    pub x: f64,
    pub lift: f64,
    pub rot: f64,
    pub squash: f64,
    pub tap: f64,
    pub tap_squash: f64,
    pub squeeze: f64,
}
/// Peek's pose override. A field the JS leaves undefined is None.
#[derive(Clone, Copy, Debug, Default)]
pub struct Override {
    pub gx: Option<f64>,
    pub gy: Option<f64>,
    pub yaw: Option<f64>,
    pub roll: Option<f64>,
    pub eye_cap: Option<f64>,
    pub droop: Option<f64>,
}
#[derive(Clone, Copy, Debug)]
pub struct PeekOut {
    pub offset_x: f64,
    pub hands: [Hand; 2],
    pub over: Option<Override>,
    pub mode: Mode,
    pub roll: f64,
    pub bob: f64,
    pub held: bool,
    pub gesture: Option<&'static str>,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct PeekInput {
    pub gx: f64,
    pub gy: f64,
    pub near: bool,
    pub poke: bool,
    pub docked: bool,
    pub reduced: bool,
    pub hold: bool,
}
struct StepState {
    dir: f64,
    from: f64,
    to: f64,
    t: f64,
    head_set: bool,
}
struct IdleHand {
    phase: f64,
    tap_t: f64,
    next_tap: f64,
}
pub struct Peek {
    pub random: Rand,
    pub size: f64,
    time: f64,
    last_attention: f64,
    last_watch: f64,
    pub mode: Mode,
    committed: f64,
    head_target: f64,
    head: Spring1,
    step: Option<StepState>,
    last_step_end: f64,
    gaze_dir: f64,
    gaze_timer: f64,
    near_timer: f64,
    away: f64,
    reduced_snap: bool,
    return_t: f64,
    reduced_now: bool,
    held: bool,
    idle: [IdleHand; 2],
}
impl Peek {
    pub fn new(size: f64, random: Rand) -> Self {
        let next = |r: &Rand| TAP_EVERY[0] + r.next() * (TAP_EVERY[1] - TAP_EVERY[0]);
        let idle = [
            IdleHand { phase: 0.0, tap_t: -1.0, next_tap: next(&random) },
            IdleHand { phase: 1.9, tap_t: -1.0, next_tap: next(&random) },
        ];
        Peek {
            random,
            size,
            time: 0.0,
            last_attention: 0.0,
            last_watch: -100.0,
            mode: Mode::Rest,
            committed: 0.0,
            head_target: 0.0,
            head: Spring1 { value: 0.0, velocity: 0.0, w: HEAD_SPRING },
            step: None,
            last_step_end: -100.0,
            gaze_dir: 0.0,
            gaze_timer: 0.0,
            near_timer: 0.0,
            away: 1.0,
            reduced_snap: false,
            return_t: 0.0,
            reduced_now: false,
            held: false,
            idle,
        }
    }
    pub fn set_size(&mut self, size: f64) {
        if size.is_finite() && size > 0.0 {
            self.size = size;
        }
    }
    pub fn head_value(&self) -> f64 {
        self.head.value
    }
    pub fn force_sulk(&mut self) {
        self.step = None;
        self.mode = Mode::Sulk;
        self.near_timer = 0.0;
        self.last_attention = self.time - IGNORE_AFTER - 1.0;
    }
    pub fn force_step(&mut self, dir: f64) {
        let d = sign(dir);
        self.begin_step(if d == 0.0 || d.is_nan() { 1.0 } else { d }, false);
    }
    fn begin_step(&mut self, dir: f64, reduced: bool) -> bool {
        let to = clamp(self.committed + dir * STEP_SIZE, -MAX_OFFSET, MAX_OFFSET);
        if (to - self.committed).abs() < 1e-6 || self.step.is_some() {
            return false;
        }
        if reduced {
            self.committed = to;
            self.head_target = to;
            self.last_step_end = self.time;
            self.reduced_snap = true;
            return true;
        }
        self.step = Some(StepState { dir, from: self.committed, to, t: 0.0, head_set: false });
        self.gaze_timer = 0.0;
        true
    }
    pub fn update(&mut self, dt: f64, input: &PeekInput) -> PeekOut {
        let n = (dt / MAX_SUB_STEP).ceil().max(1.0) as usize;
        let sub = dt / n as f64;
        let mut gesture = None;
        for i in 0..n {
            let inp = if i == 0 { *input } else { PeekInput { poke: false, ..*input } };
            if let Some(g) = self.tick(sub, &inp) {
                gesture = Some(g);
            }
        }
        let mut out = self.snapshot();
        out.gesture = gesture;
        out
    }
    fn enter_sulk(&mut self, gx: f64) {
        self.mode = Mode::Sulk;
        self.near_timer = 0.0;
        if gx.abs() > FLIP_THRESHOLD {
            self.away = -sign(gx);
        }
    }
    fn tick(&mut self, dt: f64, input: &PeekInput) -> Option<&'static str> {
        let dt = dt.max(0.0);
        self.time += dt;
        let gx = if input.gx.is_finite() { input.gx } else { 0.0 };
        let (near, poke, docked) = (input.near, input.poke, input.docked);
        let mut gesture = None;
        if near || poke {
            self.last_attention = self.time;
            self.last_watch = self.time;
        }
        let attentive = self.time - self.last_watch < ATTENTIVE_WINDOW;
        let ignored = self.time - self.last_attention >= IGNORE_AFTER;
        if !docked {
            self.step = None;
            self.committed = 0.0;
            self.head_target = 0.0;
            if matches!(self.mode, Mode::Returning | Mode::Stepping) {
                self.mode = Mode::Rest;
            }
        }
        self.held = input.hold;
        if self.held {
            self.gaze_dir = 0.0;
            self.gaze_timer = 0.0;
            if self.mode == Mode::Sulk {
                self.near_timer = if near { self.near_timer + dt } else { 0.0 };
                if poke || self.near_timer >= SULK_EXIT_NEAR {
                    self.mode = Mode::Rest;
                    self.near_timer = 0.0;
                    self.last_attention = self.time;
                    return Some("happy");
                }
            }
            return None;
        }
        if let Some(st) = self.step.as_mut() {
            st.t += dt;
            if !st.head_set && st.t >= HEAD_MOVE_AT {
                st.head_set = true;
                self.head_target = st.to;
            }
            if st.t >= STEP_DURATION {
                self.committed = st.to;
                self.head_target = st.to;
                self.step = None;
                self.last_step_end = self.time;
            }
        }
        if self.mode == Mode::Sulk {
            self.near_timer = if near { self.near_timer + dt } else { 0.0 };
            if poke || self.near_timer >= SULK_EXIT_NEAR {
                self.mode = Mode::Rest;
                self.near_timer = 0.0;
                self.gaze_timer = 0.0;
                self.gaze_dir = 0.0;
                self.last_attention = self.time;
                gesture = Some("happy");
            } else if gx * self.away > FLIP_THRESHOLD {
                self.away = -sign(gx);
            }
        } else {
            if ignored && !docked {
                self.enter_sulk(gx);
            } else if ignored && self.mode != Mode::Returning && self.step.is_none() {
                self.mode = Mode::Returning;
            }
            if self.mode == Mode::Returning {
                if !ignored {
                    self.mode = Mode::Rest;
                } else if self.step.is_none() {
                    if self.committed.abs() < 1e-6 {
                        self.enter_sulk(gx);
                    } else if self.time - self.last_step_end >= RETURN_COOLDOWN {
                        self.begin_step(-sign(self.committed), input.reduced);
                    }
                }
            }
            if matches!(self.mode, Mode::Rest | Mode::Stepping) {
                let dir = if docked && attentive && gx.abs() > GAZE_THRESHOLD { sign(gx) } else { 0.0 };
                self.gaze_timer = if dir != 0.0 && dir == self.gaze_dir { self.gaze_timer + dt } else { 0.0 };
                self.gaze_dir = dir;
                if self.step.is_none()
                    && dir != 0.0
                    && self.gaze_timer >= GAZE_HOLD
                    && self.time - self.last_step_end >= COOLDOWN
                    && (self.committed + dir * STEP_SIZE).abs() <= MAX_OFFSET + 1e-6
                {
                    self.begin_step(dir, input.reduced);
                }
                self.mode = if self.step.is_some() { Mode::Stepping } else { Mode::Rest };
            }
        }
        self.return_t = if self.mode == Mode::Returning { self.return_t + dt } else { 0.0 };
        self.tick_idle(dt, input.reduced);
        self.head.step(self.head_target, dt);
        if self.reduced_snap {
            self.head.value = self.head_target;
            self.head.velocity = 0.0;
            self.reduced_snap = false;
        }
        gesture
    }
    fn tick_idle(&mut self, dt: f64, reduced: bool) {
        self.reduced_now = reduced;
        let stepping = self.step.is_some();
        for i in 0..2 {
            if reduced {
                self.idle[i].tap_t = -1.0;
                continue;
            }
            let h = &mut self.idle[i];
            h.phase += dt * IDLE_SQUEEZE_HZ[i] * std::f64::consts::PI * 2.0;
            if h.tap_t >= 0.0 {
                h.tap_t += dt;
                if h.tap_t >= TAP_DURATION + TAP_LAND {
                    h.tap_t = -1.0;
                }
            } else if !stepping && self.time >= h.next_tap {
                h.tap_t = 0.0;
                h.next_tap = self.time + TAP_EVERY[0] + self.random.next() * (TAP_EVERY[1] - TAP_EVERY[0]);
            }
        }
    }
    fn idle_of(&self, i: usize, reduced: bool) -> (f64, f64, f64) {
        if reduced {
            return (0.0, 0.0, 0.0);
        }
        let h = &self.idle[i];
        let u = h.tap_t;
        let pi = std::f64::consts::PI;
        (
            if u >= 0.0 && u < TAP_DURATION { (pi * u / TAP_DURATION).sin() } else { 0.0 },
            if u >= TAP_DURATION { (pi * (u - TAP_DURATION) / TAP_LAND).sin() } else { 0.0 },
            h.phase.sin(),
        )
    }
    fn snapshot(&self) -> PeekOut {
        let s = self.size;
        let mut hands = [Hand::default(); 2];
        for (i, h) in hands.iter_mut().enumerate() {
            let (tap, tap_squash, squeeze) = self.idle_of(i, self.reduced_now);
            *h = Hand { x: self.committed * s, tap, tap_squash, squeeze, ..Hand::default() };
        }
        let (mut roll, mut bob) = (0.0, 0.0);
        if let Some(st) = &self.step {
            let u = st.t;
            let lead = if st.dir > 0.0 { 1 } else { 0 };
            let trail = 1 - lead;
            let l = hand_phase(u, &LEAD, HAND_ROTATION, st.dir);
            let t = hand_phase(u, &TRAIL, HAND_ROTATION * 0.6, st.dir);
            let delta = st.to - st.from;
            hands[lead] = Hand { x: (st.from + delta * l.mv) * s, lift: l.lift * s, rot: l.rot, squash: l.squash, ..hands[lead] };
            hands[trail] = Hand { x: (st.from + delta * t.mv) * s, lift: t.lift * s, rot: t.rot, squash: t.squash, ..hands[trail] };
            let k = seg(u, HEAD_MOVE_AT - 0.02, HEAD_MOVE_AT + 0.4);
            let pi = std::f64::consts::PI;
            roll = st.dir * HEAD_ROLL * (pi * k).sin();
            bob = ((pi * seg(u, HEAD_MOVE_AT, HEAD_MOVE_AT + 0.34)).sin() + 0.5 * (pi * seg(u, LEAD.land, LEAD.land + 0.14)).sin()) * HEAD_BOB * s;
        }
        let over = match self.mode {
            Mode::Sulk => {
                let a = self.away;
                Some(Override {
                    gx: Some(a * SULK_GX),
                    gy: Some(SULK_GY),
                    yaw: Some(a * SULK_YAW),
                    roll: Some(a * SULK_ROLL),
                    eye_cap: Some(EYE_CAP),
                    droop: Some(1.0),
                })
            }
            Mode::Returning => Some(Override {
                droop: Some(RETURN_DROOP_FROM + (RETURN_DROOP_TO - RETURN_DROOP_FROM) * clamp(self.return_t / RETURN_DROOP_RAMP, 0.0, 1.0)),
                ..Override::default()
            }),
            _ => None,
        };
        PeekOut { offset_x: self.head.value * s, hands, over, mode: self.mode, roll, bob, held: self.held, gesture: None }
    }
}
