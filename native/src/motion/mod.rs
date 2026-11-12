//! motion.mjs and the modules it drives. Translated line by line from the JS; the golden tests in
//! `tests/golden.rs` replay the JS outputs to keep the numbers identical.
pub mod ahoge;
pub mod attention;
pub mod cue;
pub mod peek;
pub mod preview;
pub mod small;
pub mod touch;
pub mod tow;

use attention::{Attention, Reaction};
use peek::Override;
use small::{Doze, EarTwitch, Eyelids, Slump, Wake, WakePreset};
use touch::{Touch, TouchState};
use crate::util::{clamp, Rand};

pub const YAW_LEFT: f64 = 8.0;
const LIMITS: [(f64, f64); 7] = [(-YAW_LEFT, 18.0), (-12.0, 12.0), (-10.0, 10.0), (0.0, 1.0), (0.0, 1.0), (-1.0, 1.0), (-1.0, 1.0)];

#[derive(Clone, Copy, Debug)]
pub struct Spring {
    pub value: f64,
    pub velocity: f64,
    pub frequency: f64,
}
impl Spring {
    pub fn new(value: f64, frequency: f64) -> Self {
        Spring { value, velocity: 0.0, frequency }
    }
    /// Exact critically damped solution; stable across frame rates.
    pub fn step(&mut self, target: f64, dt: f64) -> f64 {
        let dt = clamp(dt, 0.0, 0.1);
        let w = self.frequency;
        let x = self.value - target;
        let e = (-w * dt).exp();
        let c = self.velocity + w * x;
        self.value = target + (x + c * dt) * e;
        self.velocity = (self.velocity - w * c * dt) * e;
        self.value
    }
}

/// One frame of her pose: `Motion.current` in the JS, touch keys included.
#[derive(Clone, Copy, Debug, Default)]
pub struct Pose {
    pub reluctant: bool,
    pub side_eye: f64,
    pub shift_x: f64,
    pub shift_y: f64,
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub gx: f64,
    pub gy: f64,
    pub left: f64,
    pub right: f64,
    pub hair: f64,
    pub ahoge_wag: f64,
    pub ahoge_side: f64,
    pub ahoge_droop: f64,
    pub ear_mood: f64,
    pub ear_mood_l: Option<f64>,
    pub ear_sleep_l: Option<f64>,
    pub sleep: f64,
    pub sleeping: bool,
    pub wake_preset: Option<WakePreset>,
    pub rub_eyes: f64,
    pub rub_hand: f64,
    pub rub_phase: f64,
    pub rub_lift: f64,
    pub rub: f64,
    pub rub_reaction: Option<Reaction>,
    pub relax: f64,
    pub movement_blocked: bool,
    pub time: f64,
    pub secondary: bool,
    pub breath: f64,
    pub slump: f64,
    pub slump_side: f64,
    pub ear_press_l: f64,
    pub ear_press_r: f64,
    pub touch: TouchState,
}

/// Index of each spring: yaw, pitch, roll, gx, gy, hair, droop, ears, wag, side.
pub const YAW: usize = 0;
pub const PITCH: usize = 1;
pub const ROLL: usize = 2;
const GX: usize = 3;
const GY: usize = 4;
const HAIR: usize = 5;
pub const DROOP: usize = 6;
pub const EARS: usize = 7;
const WAG: usize = 8;
pub const SIDE: usize = 9;

pub struct Motion {
    pub random: Rand,
    pub touch: Touch,
    pub wake: Wake,
    pub attention: Attention,
    pub eyelids: Eyelids,
    pub doze: Doze,
    pub slump: Slump,
    /// Docked wall the head rests near: (side, gap px).
    pub wall: (f64, f64),
    last_wake_id: u32,
    pub gaze: (f64, f64),
    pub pose: (f64, f64, f64),
    pub springs: [Spring; 10],
    pub time: f64,
    pub next_blink: f64,
    blink_at: f64,
    gesture_at: f64,
    gesture_name: &'static str,
    wake_pending: bool,
    wake_ready_at: Option<f64>,
    pub follow: bool,
    pub idle: bool,
    pub reduced: bool,
    pub over: Option<Override>,
    pub current: Pose,
    pub queue: Vec<cue::Queued>,
}
impl Motion {
    pub fn new(random: Rand) -> Self {
        let touch = Touch::new(random.clone());
        let wake = Wake::new(random.clone());
        let attention = Attention::new(random.clone());
        let eyelids = Eyelids::new(random.clone());
        let doze = Doze::new(random.clone());
        let slump = Slump::new(random.clone());
        let freq = [11.0, 11.0, 11.0, 11.0, 11.0, 6.0, 5.0, 5.5, 8.0, 3.0];
        let springs = std::array::from_fn(|i| Spring::new(if i == SIDE { 1.0 } else { 0.0 }, freq[i]));
        let next_blink = 3.0 + random.next() * 3.0;
        Motion {
            random,
            touch,
            wake,
            attention,
            eyelids,
            doze,
            slump,
            wall: (0.0, 0.0),
            last_wake_id: 0,
            gaze: (0.0, 0.0),
            pose: (0.0, 0.0, 0.0),
            springs,
            time: 0.0,
            next_blink,
            blink_at: -100.0,
            gesture_at: -100.0,
            gesture_name: "",
            wake_pending: false,
            wake_ready_at: None,
            follow: true,
            idle: true,
            reduced: false,
            over: None,
            current: Pose::default(),
            queue: Vec::new(),
        }
    }
    pub fn set_gaze(&mut self, x: f64, y: f64) {
        if x.is_finite() && y.is_finite() {
            self.gaze = (clamp(x, -1.0, 1.0), clamp(y, -1.0, 1.0));
        }
    }
    pub fn blink(&mut self) {
        self.blink_at = self.time;
        self.eyelids.blink(self.time);
    }
    pub fn gesture(&mut self, name: &str) {
        if name == "blink" {
            self.blink();
            return;
        }
        self.gesture_name = match name {
            "nod" => "nod",
            "shakehead" => "shakehead",
            "happy" => "happy",
            "wink" => "wink",
            _ => "other",
        };
        self.gesture_at = self.time;
    }
    /// Queues a curve set to start after `delay` seconds.
    pub fn play_cue(&mut self, c: cue::Cue, delay: f64) -> Result<(), String> {
        if !delay.is_finite() || !(0.0..=30.0).contains(&delay) {
            return Err("无效延迟".into());
        }
        let t = self.time;
        self.queue.retain(|q| q.end > t);
        if self.queue.len() >= 24 {
            return Err("动作队列已满".into());
        }
        let (start, end) = (t + delay, t + delay + c.duration);
        self.queue.push(cue::Queued { cue: c, start, end });
        Ok(())
    }
    pub fn reset(&mut self) {
        self.queue.clear();
        self.touch.reset();
        self.attention.reset();
        self.wake_pending = false;
        self.wake_ready_at = None;
        self.eyelids.reset();
        self.wake.reset();
        self.doze.reset();
        self.slump.reset();
        self.last_wake_id = 0;
        for i in [EARS, WAG] {
            self.springs[i].value = 0.0;
            self.springs[i].velocity = 0.0;
        }
        self.springs[SIDE].value = 1.0;
        self.springs[SIDE].velocity = 0.0;
        self.pose = (0.0, 0.0, 0.0);
        self.gesture_at = -100.0;
        self.gaze = (0.0, 0.0);
        self.blink_at = -100.0;
        self.next_blink = self.time + 3.0;
    }
    pub fn blocks_travel(&self) -> bool {
        let a = &self.attention.current;
        self.touch.bonking()
            || self.touch.dip.active
            || self.slump.active()
            || a.reluctant.active
            || a.sleeping
            || self.wake.active()
            || (!a.interacting && (a.rubbing || a.resting || a.sleep > 0.01 || self.wake_pending || self.wake.active()))
    }
    pub fn step(&mut self, dt: f64) -> Pose {
        use std::f64::consts::PI;
        self.time += clamp(dt, 0.0, 0.1);
        let t = self.time;
        let attention = self.attention.current;
        let sleep = attention.sleep;
        let mut touch = self.touch.step(dt, self.reduced, self.idle && !attention.sleeping && sleep < 0.1);
        if self.idle && !self.reduced && !attention.sleeping && sleep < 0.1 && t >= self.next_blink {
            self.blink();
            self.next_blink = t + 3.2 + self.random.next() * 4.0;
        }
        let dream = self.doze.step(dt, self.idle && attention.sleeping && sleep > 0.7, self.reduced, Some(self.attention.idle_time));
        if let Some((left, ear)) = dream.ear {
            if self.wake.preset != Some(WakePreset::Peek) {
                if left {
                    touch.ear_twitch_l = Some(ear);
                    touch.ear_fold_l = 0.0;
                } else {
                    touch.ear_twitch_r = Some(ear);
                    touch.ear_fold_r = 0.0;
                }
            }
        }
        let pet = attention.rub * (1.0 - sleep);
        let tow_busy = self.touch.anchor.is_some() || self.touch.tow.busy();
        let (sm, side) = self.slump.step(
            dt,
            self.wall.0,
            self.idle && !self.reduced && !attention.sleeping && sleep < 0.05 && !self.wake.active() && !attention.reluctant.active && !attention.rubbing,
            tow_busy || self.touch.fringe.held || touch.bonk != 0.0 || touch.dip > 0.0 || touch.dip_mix != 0.0,
        );
        let dm = touch.dip_mix;
        let (lids_l, lids_r) = self.eyelids.sample(t, attention.rub, attention.eye_cap);
        if attention.wake_id != self.last_wake_id {
            self.last_wake_id = attention.wake_id;
            if !self.wake.active() || self.wake.preset == Some(WakePreset::Peek) {
                self.wake.start(WakePreset::Gentle);
            }
        }
        if (touch.bonk != 0.0 && self.wake.active()) || (touch.guard > 0.12 && self.wake.preset == Some(WakePreset::Rubeyes)) {
            self.wake.finish();
        }
        let wake_pose = self.wake.step(
            dt,
            attention.sleep_closure == 0.0 && lids_l >= 0.99 && lids_r >= 0.99,
            self.reduced,
            Some(self.attention.idle_time),
        );
        let peeking = self.wake.preset == Some(WakePreset::Peek);
        if peeking {
            touch.ear_twitch_l = None;
            touch.ear_twitch_r = None;
            touch.ear_fold_l = 0.0;
            touch.ear_fold_r = 0.0;
        }
        if attention.interacting {
            self.wake_pending = false;
            self.wake_ready_at = None;
        } else if (attention.rubbing && attention.reaction == Some(Reaction::Sleepy))
            || attention.resting
            || attention.sleeping
            || attention.sleep_closure > 0.0
        {
            self.wake_pending = true;
            self.wake_ready_at = None;
        } else if self.wake_pending {
            if attention.relax == 0.0
                && attention.sleep_closure == 0.0
                && lids_l >= attention.eye_cap - 1e-6
                && lids_r >= attention.eye_cap - 1e-6
            {
                let ready = *self.wake_ready_at.get_or_insert(t);
                if t - ready >= 0.1 {
                    self.wake_pending = false;
                    self.wake_ready_at = None;
                }
            } else {
                self.wake_ready_at = None;
            }
        }
        let waking = self.wake_pending && !attention.sleeping && !(attention.rubbing && attention.reaction == Some(Reaction::Sleepy));
        let reluctant = attention.reluctant;
        let rm = reluctant.mix;
        let ov = if reluctant.active { None } else { self.over };
        let ov_gaze = ov.is_some_and(|o| o.gx.is_some());
        let weight = if self.attention.time > 0.0 { attention.gaze_weight } else { 1.0 };
        let gx = if ov_gaze {
            clamp(ov.unwrap().gx.unwrap(), -1.0, 1.0)
        } else if self.follow {
            self.gaze.0 * weight
        } else {
            0.0
        };
        let gy = if ov_gaze {
            clamp(ov.unwrap().gy.unwrap_or(0.0), -1.0, 1.0)
        } else if self.follow {
            self.gaze.1 * weight
        } else {
            0.0
        };
        let mut look_x = gx * (1.0 - rm) + reluctant.gx * rm;
        let mut look_y = gy * (1.0 - rm);
        look_x = look_x * (1.0 - dm) - touch.dip_dir * 0.55 * dm;
        look_y = look_y * (1.0 - dm) + 0.3 * dm;
        look_x *= 1.0 - sm;
        look_y = look_y * (1.0 - sm) + 0.4 * sm;
        let (py, pp, pr) = self.pose;
        let mut ty = py + gx * 14.0;
        let mut tp = pp - gy * 8.0 - touch.pain * 3.0;
        let mut tr = pr + gx * 2.5 + touch.ahoge_pull_x * 15.0;
        tr += touch.tow_lean * 7.0;
        ty += touch.tow_lean * 4.0;
        tp += 4.0 * touch.dip_mix;
        ty -= touch.dip_dir * 5.0 * dm;
        ty *= 1.0 - 0.8 * sm;
        tr = tr * (1.0 - sm) + side * 9.0 * sm;
        tp += 3.0 * sm;
        if rm != 0.0 {
            ty = ty * (1.0 - rm) + py * rm + reluctant.yaw;
            tr = tr * (1.0 - rm) + pr * rm + reluctant.roll;
        }
        if let Some(o) = ov {
            ty += o.yaw.unwrap_or(0.0);
            tr += o.roll.unwrap_or(0.0);
        }
        if self.idle && !self.reduced {
            tp += (t * 1.35).sin() * 0.65 * (1.0 - pet);
            tr += (t * 0.65).sin() * 0.45 * (1.0 - pet);
        }
        if pet != 0.0 {
            let (ay, ap, ar) = if self.reduced { (0.0, 0.0, 0.0) } else { (attention.yaw, attention.pitch, attention.roll) };
            ty = py + (ty - py) * (1.0 - pet) + ay * pet;
            tp = pp + (tp - pp) * (1.0 - pet) + ap * pet;
            tr = pr + (tr - pr) * (1.0 - pet) + ar * pet;
        }
        if sleep != 0.0 {
            ty *= 1.0 - sleep;
            tr *= 1.0 - sleep;
            tp = tp * (1.0 - sleep) + 3.0 * sleep;
        }
        if self.wake.active() && !peeking {
            ty = py + (ty - py) * 0.2 + wake_pose.yaw;
            tp = pp + (tp - pp) * 0.2 + wake_pose.pitch;
            tr = pr + (tr - pr) * 0.2 + wake_pose.roll;
        }
        let head_freq = if pet > 0.1 || sleep > 0.1 { 3.2 } else { 11.0 };
        for i in [YAW, PITCH, ROLL] {
            self.springs[i].frequency = head_freq;
        }
        let gt = t - self.gesture_at;
        let env = if !self.wake.active() && gt >= 0.0 && gt < 1.8 { (gt / 1.8 * PI).sin() } else { 0.0 };
        match self.gesture_name {
            "nod" => tp += (gt * 10.0).sin() * 6.0 * env,
            "shakehead" => ty += (gt * 11.0).sin() * 10.0 * env,
            "happy" => tr += (gt * 8.0).sin() * 5.0 * env,
            _ => {}
        }
        if self.reduced {
            self.springs[WAG].value = 0.0;
            self.springs[WAG].velocity = 0.0;
        }
        let pet_wag = if self.reduced { 0.0 } else { self.springs[WAG].step(if waking { 0.0 } else { attention.ahoge_wag }, dt) };
        let happy_wag = if self.gesture_name == "happy" && env > 0.0 {
            ((gt * 16.0).sin() * 14.0 + (gt * 9.0 + 1.0).sin() * 3.0) * env
        } else {
            0.0
        };
        let wag = if self.reduced { 0.0 } else { pet_wag + wake_pose.wag + dream.wag * sleep + touch.ahoge_sway + happy_wag };
        let ov_droop = ov.map_or(0.0, |o| clamp(o.droop.unwrap_or(0.0), 0.0, 1.0));
        let droop_target = ov_droop.max(attention.droop).max(sleep).max(rm * 0.65).max(0.9 * sm).max(0.45 * touch.dip_mix) * (1.0 - pet);
        let droop_spring = &mut self.springs[DROOP];
        droop_spring.frequency = if droop_target > droop_spring.value { 5.0 } else { 9.5 };
        let excited = if self.gesture_name == "happy" { env } else { 0.0 };
        let ear_target = excited * (1.0 - droop_target) - droop_target + wake_pose.ears;
        self.springs[EARS].frequency = if ear_target < self.springs[EARS].value { 5.5 } else { 8.5 };
        // p = the seven Live2D-style parameters.
        let mut p = [ty, tp, tr, lids_l, lids_r, look_x + wake_pose.gx, look_y];
        self.queue.retain(|q| q.end > t);
        for q in &self.queue {
            for (k, v) in cue::cue_sample(&q.cue, t - q.start) {
                p[k] += v;
            }
        }
        if p[0] < 0.0 {
            p[0] = -YAW_LEFT * (-p[0] / YAW_LEFT).tanh();
        }
        for (v, (lo, hi)) in p.iter_mut().zip(LIMITS) {
            *v = clamp(*v, lo, hi);
        }
        if rm != 0.0 {
            p[3] = p[3].min(reluctant.eye_cap);
            p[4] = p[4].min(reluctant.eye_cap);
        }
        if let Some(cap) = ov.and_then(|o| o.eye_cap).filter(|c| c.is_finite()) {
            p[3] = p[3].min(cap);
            p[4] = p[4].min(cap);
        }
        if let Some(cap) = wake_pose.eye_cap.filter(|c| c.is_finite()) {
            p[3] = cap;
            p[4] = cap;
        }
        if self.gesture_name == "wink" && gt >= 0.0 && gt < 0.6 {
            p[3] *= (gt / 0.6 * PI).cos().abs();
        }
        if peeking {
            p[3] = wake_pose.peek_eye;
            p[4] = 0.0;
        }
        if touch.dip_kind != 0.0 {
            let shut = 1.0 - touch.dip_mix;
            p[3] *= shut;
            p[4] *= shut;
        }
        let lid_cap = 1.0 - 0.45 * dm * if touch.dip_kind != 0.0 { 0.0 } else { 1.0 } - 0.58 * sm - 0.35 * touch.tow_wince;
        if lid_cap < 1.0 {
            p[3] = p[3].min(lid_cap);
            p[4] = p[4].min(lid_cap);
        }
        let reduced = self.reduced;
        let ease = |springs: &mut [Spring; 10], k: usize, v: f64| {
            if waking && matches!(k, YAW | PITCH | ROLL | HAIR) {
                springs[k].velocity = 0.0;
                return springs[k].value;
            }
            if reduced {
                springs[k].value = v;
                v
            } else {
                springs[k].step(v, dt)
            }
        };
        let springs = &mut self.springs;
        let yaw = ease(springs, YAW, p[0]);
        let pitch = ease(springs, PITCH, p[1]);
        let roll = ease(springs, ROLL, p[2]);
        let gx = ease(springs, GX, p[5]);
        let gy = ease(springs, GY, p[6]);
        let hair = ease(springs, HAIR, p[0]);
        let side_now = springs[SIDE].value;
        let ahoge_side = ease(springs, SIDE, dream.side.unwrap_or(side_now));
        let ahoge_droop = ease(springs, DROOP, droop_target);
        let ear_mood = clamp(ease(springs, EARS, ear_target), -1.0, 1.0);
        let movement_blocked = self.blocks_travel();
        self.current = Pose {
            reluctant: reluctant.active,
            side_eye: rm,
            shift_x: reluctant.shift_x + touch.ahoge_pull_x * 0.6,
            shift_y: touch.ahoge_pull_y * 0.48,
            yaw,
            pitch,
            roll,
            gx,
            gy,
            left: p[3],
            right: p[4],
            hair,
            ahoge_wag: wag,
            ahoge_side,
            ahoge_droop,
            ear_mood,
            ear_mood_l: if peeking { Some(-1.0 + 1.45 * wake_pose.peek_ear) } else { None },
            ear_sleep_l: if peeking { Some(1.0 - wake_pose.peek_ear) } else { None },
            sleep,
            sleeping: attention.sleeping,
            wake_preset: self.wake.preset,
            rub_eyes: wake_pose.rub_eyes,
            rub_hand: wake_pose.rub_hand.unwrap_or(0.0),
            rub_phase: wake_pose.rub_phase,
            rub_lift: wake_pose.rub_lift,
            rub: pet,
            rub_reaction: attention.reaction,
            relax: attention.relax,
            movement_blocked,
            time: t,
            secondary: self.idle && !self.reduced && sleep < 0.1,
            breath: if self.idle && !self.reduced {
                if sleep > 0.5 {
                    dream.breath * sleep
                } else {
                    (t * 1.6).sin() * 0.0018 + sm * (t * 1.05).sin() * 0.0025
                }
            } else {
                0.0
            },
            slump: sm,
            slump_side: side,
            ear_press_l: if side < 0.0 { sm } else { 0.0 },
            ear_press_r: if side > 0.0 { sm } else { 0.0 },
            touch,
        };
        self.current
    }
}

/// The values one ear's deformation reads from a pose (`deformEar` falls back from the
/// per-side keys to the shared ones).
pub fn ear_input(s: &Pose, left: bool) -> small::EarInput {
    small::EarInput {
        sleep: if left { s.ear_sleep_l.unwrap_or(s.sleep) } else { s.sleep },
        mood: if left { s.ear_mood_l.unwrap_or(s.ear_mood) } else { s.ear_mood },
        twitch: if left { s.touch.ear_twitch_l } else { s.touch.ear_twitch_r },
        fold: if left { s.touch.ear_fold_l } else { s.touch.ear_fold_r },
        press: if left { s.ear_press_l } else { s.ear_press_r },
    }
}
#[allow(dead_code)]
fn _assert_types(_: EarTwitch) {}
