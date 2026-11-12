//! attention.mjs: noticing the pointer, being stroked, drooping when ignored, falling asleep.
use super::small::{Reluctance, ReluctanceInput, ReluctanceSample, Sleep, SleepInput, Wake};
use crate::util::{clamp, finite_or_zero, smooth, Rand};

pub const STILL_AFTER: f64 = 7.0;
pub const AWAY_AFTER: f64 = 3.0;
pub const NEAR_GRACE: f64 = 1.2;
pub const RUB_SETTLE: f64 = 3.0;
pub const WAKE_DELAY_MIN: f64 = 2.0;
pub const WAKE_DELAY_MAX: f64 = 5.0;
pub const RUB_SESSION_GAP: f64 = 0.65;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reaction {
    Sleepy,
    Playful,
    Subtle,
}
impl Reaction {
    pub fn name(self) -> &'static str {
        match self {
            Reaction::Sleepy => "sleepy",
            Reaction::Playful => "playful",
            Reaction::Subtle => "subtle",
        }
    }
}
#[derive(Clone, Copy, Debug, Default)]
pub struct AttentionState {
    pub reluctant: ReluctanceSample,
    pub sleep: f64,
    pub sleep_closure: f64,
    pub sleeping: bool,
    pub wake_id: u32,
    pub woke: bool,
    pub inactive_for: f64,
    pub gaze_weight: f64,
    pub rub: f64,
    pub relax: f64,
    pub eye_cap: f64,
    pub droop: f64,
    pub yaw: f64,
    pub roll: f64,
    pub pitch: f64,
    pub ahoge_wag: f64,
    pub reaction: Option<Reaction>,
    pub attentive: bool,
    pub rubbing: bool,
    pub resting: bool,
    pub interacting: bool,
}
/// One frame of input. Missing JS values are NaN (pointer) or false.
#[derive(Clone, Copy, Debug)]
pub struct AttentionInput {
    pub now: f64,
    pub reduced: bool,
    pub follow: bool,
    pub inner_side: f64,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub near: bool,
    pub over_head: bool,
    pub hx: f64,
    pub hy: f64,
    pub blocked: bool,
    pub wake: bool,
    pub poke: bool,
}
impl Default for AttentionInput {
    fn default() -> Self {
        AttentionInput {
            now: f64::NAN,
            reduced: false,
            follow: true,
            inner_side: f64::NAN,
            x: f64::NAN,
            y: f64::NAN,
            size: 240.0,
            near: false,
            over_head: false,
            hx: 0.0,
            hy: 0.0,
            blocked: false,
            wake: false,
            poke: false,
        }
    }
}

pub struct Attention {
    pub random: Rand,
    pub reluctance: Reluctance,
    pub sleep_controller: Sleep,
    pub idle_time: f64,
    last_interaction: f64,
    pub last_clock: Option<f64>,
    pub time: f64,
    last: Option<(f64, f64)>,
    last_move: f64,
    pub last_near: f64,
    rub_age: f64,
    rub_mix: f64,
    rest_until: f64,
    was_stroking: bool,
    reaction: Option<Reaction>,
    reaction_time: f64,
    last_rub_at: f64,
    release_closure: f64,
    gaze_weight: f64,
    pub droop: f64,
    sway_x: f64,
    sway_y: f64,
    pub current: AttentionState,
}
impl Attention {
    pub fn new(random: Rand) -> Self {
        let mut a = Attention {
            reluctance: Reluctance::new(random.clone()),
            sleep_controller: Sleep::new(random.clone()),
            random,
            idle_time: 0.0,
            last_interaction: 0.0,
            last_clock: None,
            time: 0.0,
            last: None,
            last_move: -100.0,
            last_near: 0.0,
            rub_age: 0.0,
            rub_mix: 0.0,
            rest_until: 0.0,
            was_stroking: false,
            reaction: None,
            reaction_time: 0.0,
            last_rub_at: f64::NEG_INFINITY,
            release_closure: 0.0,
            gaze_weight: 0.0,
            droop: 0.0,
            sway_x: 0.0,
            sway_y: 0.0,
            current: AttentionState::default(),
        };
        a.reset();
        a
    }
    pub fn reset(&mut self) {
        self.sleep_controller.reset();
        self.reluctance.reset();
        self.idle_time = 0.0;
        self.last_interaction = 0.0;
        self.last_clock = None;
        self.time = 0.0;
        self.last = None;
        self.last_move = -100.0;
        self.last_near = 0.0;
        self.rub_age = 0.0;
        self.rub_mix = 0.0;
        self.rest_until = 0.0;
        self.was_stroking = false;
        self.reaction = None;
        self.reaction_time = 0.0;
        self.last_rub_at = f64::NEG_INFINITY;
        self.release_closure = 0.0;
        self.gaze_weight = 0.0;
        self.droop = 0.0;
        self.sway_x = 0.0;
        self.sway_y = 0.0;
        self.current = AttentionState { eye_cap: 1.0, ..AttentionState::default() };
    }
    fn pick_reaction(&self) -> Reaction {
        let draw = self.random.next();
        if draw < 0.2 {
            Reaction::Sleepy
        } else if draw < 0.7 {
            Reaction::Playful
        } else {
            Reaction::Subtle
        }
    }
    /// `wake` stands in for the JS `requestWake` callback (Motion passes its Wake).
    pub fn update(&mut self, dt: f64, input: &AttentionInput, wake: &mut Wake) -> AttentionState {
        let dt = clamp(finite_or_zero(dt), 0.0, 0.1);
        self.time += dt;
        let clock = if input.now.is_finite() { Some(input.now) } else { None };
        self.idle_time += match (clock, self.last_clock) {
            (Some(c), Some(l)) => (c - l).max(0.0),
            _ => dt,
        };
        self.last_clock = clock;
        let size = if input.size.is_finite() && input.size != 0.0 { input.size.max(1.0) } else { 240.0 };
        let valid = input.x.is_finite() && input.y.is_finite();
        let near = valid && input.near;
        let moved = valid
            && match self.last {
                None => true,
                Some((lx, ly)) => (input.x - lx).hypot(input.y - ly) >= 0.6f64.max(size * 0.003),
            };
        self.last = if valid { Some((input.x, input.y)) } else { None };
        if moved {
            self.last_move = self.time;
            if near {
                self.last_near = self.time;
            }
        }
        if input.poke {
            self.last_move = self.time;
            self.last_near = self.time;
        }
        let stroking = valid && input.over_head && !input.blocked && !self.sleep_controller.sleeping && self.sleep_controller.depth < 0.05;
        if input.blocked || input.poke || stroking {
            self.rest_until = 0.0;
        } else if self.was_stroking && self.reaction == Some(Reaction::Sleepy) && self.current.relax > 0.8 && self.rub_mix > 0.8 {
            self.rest_until = self.time + WAKE_DELAY_MIN + (WAKE_DELAY_MAX - WAKE_DELAY_MIN) * clamp(self.random.next(), 0.0, 1.0);
        }
        self.was_stroking = stroking;
        let resting = !stroking && self.time < self.rest_until;
        let recent = self.time - self.last_move < 0.3;
        if stroking && (recent || (self.rub_age > 0.35 && self.time - self.last_move < STILL_AFTER)) {
            self.rub_age = (self.rub_age + dt).min(4.0);
        } else if !resting {
            self.rub_age = (self.rub_age - dt * 3.5).max(0.0);
        }
        let rubbing = stroking && self.rub_age > 0.12;
        let comfortable = rubbing || resting;
        if rubbing {
            if self.reaction.is_none() || self.time - self.last_rub_at > RUB_SESSION_GAP {
                let previous = self.reaction;
                self.reaction = Some(self.pick_reaction());
                self.reaction_time = 0.0;
                self.release_closure = if self.reaction == Some(Reaction::Sleepy) { 0.0 } else { 1.0 - self.current.eye_cap };
                if previous != Some(Reaction::Sleepy) || self.reaction != Some(Reaction::Sleepy) || self.current.relax < 0.8 {
                    self.rub_age = self.rub_age.min(0.15);
                }
            }
            self.last_rub_at = self.time;
            self.reaction_time += dt;
        }
        let reluctant = self.reluctance.update(
            dt,
            &ReluctanceInput {
                droop: self.droop,
                active: (moved && near) || input.poke,
                eligible: !self.sleep_controller.sleeping && self.sleep_controller.depth < 0.05 && !rubbing && !resting && !input.blocked,
                enabled: input.follow && !input.reduced,
                hx: input.hx,
                inner_side: input.inner_side,
            },
        );
        let blend = |a: f64, b: f64, rate: f64| a + (b - a) * (1.0 - (-dt * rate).exp());
        self.rub_mix = blend(self.rub_mix, if comfortable { 1.0 } else { 0.0 }, if comfortable { 6.0 } else { 7.0 });
        self.release_closure = blend(self.release_closure, 0.0, 5.0);
        if self.release_closure < 0.001 {
            self.release_closure = 0.0;
        }
        let relax = if self.reaction == Some(Reaction::Sleepy) {
            smooth((self.rub_age - 0.45) / (RUB_SETTLE - 0.45))
        } else {
            self.release_closure
        };
        let look = (near || self.time - self.last_near < AWAY_AFTER)
            && self.time - self.last_move < STILL_AFTER
            && self.time - self.last_near < STILL_AFTER;
        self.gaze_weight = blend(self.gaze_weight, if look { 1.0 } else { 0.0 }, if look { 5.0 } else { 2.0 });
        let age = self.time - self.last_near;
        self.droop = blend(self.droop, if comfortable { 0.0 } else { smooth((age - 7.0) / 11.0) }, if comfortable { 5.0 } else { 1.8 });
        self.sway_x = blend(self.sway_x, clamp(input.hx, -1.0, 1.0), 3.2);
        self.sway_y = blend(self.sway_y, clamp(input.hy, -1.0, 1.0), 3.2);
        let mut yaw = self.sway_x * 6.0 * (1.0 - relax);
        let mut roll = self.sway_x * 2.4 * (1.0 - relax);
        let mut pitch = -self.sway_y * 2.0 * (1.0 - relax);
        let mut ahoge_wag = 0.0;
        let phase = self.reaction_time * 2.7;
        let activity = (0.25 + 0.75 * (1.0 - smooth((self.time - self.last_move - 0.15) / 1.0))) * smooth(self.reaction_time / 0.65);
        match self.reaction {
            Some(Reaction::Playful) => {
                yaw = (phase.sin() * 4.8 + self.sway_x * 2.0) * activity;
                roll = ((phase * 1.05 + 0.6).sin() * 3.3 + self.sway_x) * activity;
                pitch = ((phase * 0.8).sin() * 2.1 - self.sway_y * 0.7) * activity;
                ahoge_wag = ((phase * 2.0).sin() * 9.0 + (phase * 3.2 + 0.4).sin() * 2.0) * activity * self.rub_mix;
            }
            Some(Reaction::Subtle) => {
                yaw = (self.sway_x * 1.4 + (phase * 0.65).sin() * 0.5) * activity;
                roll = (self.sway_x * 0.4 + (phase * 0.65 + 0.4).sin() * 0.5) * activity;
                pitch = (-self.sway_y * 0.4 + (phase * 0.5).sin() * 0.3) * activity;
            }
            _ => {}
        }
        let active = input.wake || input.poke || input.blocked || (moved && near);
        if active {
            self.last_interaction = self.idle_time;
        }
        let inactive_for = self.idle_time - self.last_interaction;
        let wake_now = input.wake && (!self.sleep_controller.sleeping || wake.request(self.idle_time));
        let sleep = self.sleep_controller.update(
            dt,
            &SleepInput {
                idle_for: inactive_for,
                active,
                wake: wake_now,
                eligible: (self.droop > 0.9 && !rubbing && !resting) || inactive_for >= 120.0,
                reduced: input.reduced,
            },
        );
        let cap_a = 1.0 - relax * self.rub_mix;
        let cap_b = if !sleep.sleeping && sleep.depth > 0.0 { 1.0 } else { 1.0 - 0.32 * self.droop };
        let cap_c = 1.0 - sleep.closure;
        self.current = AttentionState {
            reluctant,
            sleep: sleep.depth,
            sleep_closure: sleep.closure,
            sleeping: sleep.sleeping,
            wake_id: sleep.wake_id,
            woke: sleep.woke,
            inactive_for,
            gaze_weight: self.gaze_weight,
            rub: self.rub_mix,
            relax,
            eye_cap: cap_a.min(cap_b).min(cap_c),
            droop: self.droop,
            yaw,
            roll,
            pitch,
            ahoge_wag,
            reaction: self.reaction,
            attentive: !sleep.sleeping && near && (self.time - self.last_move < NEAR_GRACE || rubbing),
            rubbing,
            resting,
            interacting: input.blocked || input.poke,
        };
        self.current
    }
}
/// Excludes the ahoge/ears, while admitting a little space around the scalp.
pub fn head_contact(x: f64, y: f64, size: f64) -> bool {
    let hx = (x / size - 0.5) / 0.30;
    let hy = (y / size - 0.46) / 0.23;
    hx * hx + hy * hy < 1.0
}
