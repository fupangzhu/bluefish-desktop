//! tow.mjs: ahoge-led travel along the taskbar (Tow), and the duck that follows it (Dip).
use super::ahoge::{ahoge_reach, bind_ahoge, Reach, TAUT_ENGAGE, TAUT_MAX};
use crate::util::{clamp, finite_or_zero, sign, Pt, Rand};
use std::sync::LazyLock;

pub const TOW_WARN: f64 = 0.85;
pub const TOW_LIFT: f64 = 1.06;
pub const TOW_WALL_SLIP: f64 = 1.3;
pub const TOW_OMEGA: f64 = 20.0;
pub const TOW_ZETA: f64 = 0.45;
pub const TOW_SLIDE: f64 = 9.0;
pub const TOW_GLIDE: f64 = 11.0;
pub const TOW_STOP_SPEED: f64 = 8.0;
pub const TOW_DIP_AFTER: f64 = 0.12;
const ART_TO_PX: f64 = 1.76 / 4096.0;
static TIP_REACH: LazyLock<Reach> = LazyLock::new(|| ahoge_reach(&bind_ahoge(Pt::new(1535.0, 280.0))));

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TowEnd {
    pub traveled: f64,
    pub slipped: bool,
    pub dir: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct TowOut {
    pub slip: bool,
    pub ended: Option<TowEnd>,
    pub active: bool,
    pub engaged: bool,
    pub offset: f64,
    pub velocity: f64,
    pub stretch: f64,
    pub dy: f64,
    pub ratio: f64,
    pub height: f64,
}
#[derive(Clone, Debug)]
pub struct Tow {
    pub active: bool,
    pub engaged: bool,
    pub gliding: bool,
    pub offset: f64,
    pub velocity: f64,
    start: Option<Pt>,
    cursor: Option<Pt>,
    pub size: f64,
    min: f64,
    max: f64,
    traveled: f64,
    slipped: bool,
    dir: f64,
    pub pending_end: Option<TowEnd>,
    root: Pt,
    length: f64,
}
impl Default for Tow {
    fn default() -> Self {
        Tow {
            active: false,
            engaged: false,
            gliding: false,
            offset: 0.0,
            velocity: 0.0,
            start: None,
            cursor: None,
            size: 240.0,
            min: f64::NEG_INFINITY,
            max: f64::INFINITY,
            traveled: 0.0,
            slipped: false,
            dir: 0.0,
            pending_end: None,
            root: Pt::default(),
            length: 1.0,
        }
    }
}
impl Tow {
    pub fn reset(&mut self) {
        *self = Tow::default();
    }
    pub fn busy(&self) -> bool {
        self.active || self.gliding
    }
    pub fn begin(&mut self, point: Pt, size: f64, reach: Option<Reach>) -> bool {
        self.reset();
        if !point.x.is_finite() || !point.y.is_finite() {
            return false;
        }
        let reach = reach.unwrap_or(*TIP_REACH);
        self.active = true;
        self.size = if size.is_finite() && size > 0.0 { size } else { 240.0 };
        self.start = Some(point);
        self.cursor = Some(point);
        let k = self.size * ART_TO_PX;
        self.root = Pt::new(reach.x * k, reach.y * k);
        self.length = (0.06 * self.size).max(reach.arc * k);
        true
    }
    pub fn set_limits(&mut self, min: f64, max: f64) {
        if min.is_finite() && max.is_finite() && min <= max {
            self.min = min;
            self.max = max;
        }
    }
    pub fn move_to(&mut self, point: Pt) {
        if self.active && point.x.is_finite() && point.y.is_finite() {
            self.cursor = Some(point);
        }
    }
    pub fn release(&mut self, reduced: bool) {
        if !self.active {
            return;
        }
        self.active = false;
        self.gliding = self.engaged && !reduced && self.velocity.abs() > TOW_STOP_SPEED;
        if !self.gliding {
            self.finish();
        }
    }
    fn finish(&mut self) {
        self.gliding = false;
        self.velocity = 0.0;
        self.pending_end = Some(TowEnd { traveled: self.traveled / self.size, slipped: self.slipped, dir: self.dir });
    }
    fn limit(&mut self) {
        if self.offset < self.min {
            self.offset = self.min;
            if self.velocity < 0.0 {
                self.velocity = 0.0;
            }
        }
        if self.offset > self.max {
            self.offset = self.max;
            if self.velocity > 0.0 {
                self.velocity = 0.0;
            }
        }
    }
    fn rope(&self) -> (f64, f64, f64) {
        let (c, s) = (self.cursor.unwrap(), self.start.unwrap());
        let x = self.root.x + c.x - s.x - self.offset;
        let y = self.root.y + c.y - s.y;
        (x, y, x.hypot(y))
    }
    pub fn step(&mut self, dt: f64, reduced: bool) -> TowOut {
        let dt = clamp(finite_or_zero(dt), 0.0, 0.1);
        let (mut slip, mut ended) = (false, None);
        let l = self.length;
        if self.active {
            if !self.engaged && self.rope().2 >= TAUT_ENGAGE * l {
                self.engaged = true;
            }
            if self.engaged {
                let w = TOW_OMEGA;
                let z = if reduced { 1.0 } else { TOW_ZETA };
                let n = (dt * 240.0).ceil().max(1.0) as usize;
                let h = dt / n as f64;
                let longest = TAUT_MAX * l;
                for _ in 0..n {
                    let (rx, _ry, rr) = self.rope();
                    let taut = rr > l;
                    let pull = if taut { w * w * (rr - l) * rx / rr } else { 0.0 };
                    let damping = if taut { 2.0 * z * w } else { TOW_SLIDE };
                    self.velocity += (pull - damping * self.velocity) * h;
                    let before = self.offset;
                    self.offset += self.velocity * h;
                    let (rx, ry, rr) = self.rope();
                    if rr > longest && ry.abs() < longest {
                        let (c, s) = (self.cursor.unwrap(), self.start.unwrap());
                        self.offset = self.root.x + c.x - s.x - sign(rx) * (longest * longest - ry * ry).sqrt();
                    }
                    self.limit();
                    self.traveled += (self.offset - before).abs();
                }
                if self.velocity.abs() > 1.0 {
                    self.dir = sign(self.velocity);
                }
            }
            let (_rx, ry, rr) = self.rope();
            if ry.abs() >= TOW_LIFT * l || rr >= TOW_WALL_SLIP * l {
                self.slipped = true;
                slip = true;
                self.release(reduced);
            }
        } else if self.gliding {
            let before = self.offset;
            self.velocity *= (-TOW_GLIDE * dt).exp();
            self.offset += self.velocity * dt;
            self.limit();
            self.traveled += (self.offset - before).abs();
            if self.velocity.abs() < TOW_STOP_SPEED {
                self.finish();
            }
        }
        if let Some(e) = self.pending_end.take() {
            ended = Some(e);
        }
        let (dx, dy) = match (self.cursor, self.start) {
            (Some(c), Some(s)) => (c.x - s.x, c.y - s.y),
            _ => (0.0, 0.0),
        };
        let (ry, rr) = if self.cursor.is_some() {
            let (_, y, r) = self.rope();
            (y, r)
        } else {
            (self.root.y, self.root.x.hypot(self.root.y))
        };
        TowOut {
            slip,
            ended,
            active: self.active,
            engaged: self.engaged,
            offset: self.offset,
            velocity: self.velocity,
            stretch: dx - self.offset,
            dy,
            ratio: rr / l,
            height: ry.abs() / l,
        }
    }
}

// ---- Dip ------------------------------------------------------------------------------------
pub const DIP_DEPTH: f64 = 0.3;
const DIP_SETTLE: f64 = 0.45;
const DIP_DOWN: f64 = 11.0;
const DIP_UP: f64 = 4.2;
const DIP_QUICK: f64 = 12.0;
const SWAY_OMEGA: f64 = 2.0 * std::f64::consts::PI * 2.3;
const SWAY_ZETA: f64 = 0.12;
const SWAY_GAIN: f64 = 150.0;
const SWAY_LIMIT: f64 = 20.0;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DipKind {
    Tow,
    Bonk,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct DipOut {
    pub dip: f64,
    pub dip_mix: f64,
    pub dip_dir: f64,
    pub dip_kind: f64,
    pub ahoge_sway: f64,
}
pub struct Dip {
    pub random: Rand,
    y: f64,
    v: f64,
    pub active: bool,
    t: f64,
    hold: f64,
    dir: f64,
    kind: DipKind,
    delay: f64,
    hold_end: f64,
    quick: bool,
    sway: f64,
    sway_velocity: f64,
}
impl Dip {
    pub fn new(random: Rand) -> Self {
        Dip {
            random,
            y: 0.0,
            v: 0.0,
            active: false,
            t: 0.0,
            hold: 0.0,
            dir: 0.0,
            kind: DipKind::Tow,
            delay: 0.0,
            hold_end: f64::INFINITY,
            quick: false,
            sway: 0.0,
            sway_velocity: 0.0,
        }
    }
    pub fn reset(&mut self) {
        self.active = false;
        self.t = 0.0;
        self.hold = 0.0;
        self.dir = 0.0;
        self.kind = DipKind::Tow;
        self.delay = 0.0;
        self.hold_end = f64::INFINITY;
        self.quick = false;
    }
    pub fn remaining(&self) -> f64 {
        if self.active {
            (self.hold_end - self.t).max(0.0) + 1.2
        } else {
            0.0
        }
    }
    pub fn start(&mut self, dir: f64, kind: DipKind) {
        let hold = match kind {
            DipKind::Tow => [1.3, 2.3],
            DipKind::Bonk => [1.8, 2.6],
        };
        self.active = true;
        self.t = 0.0;
        self.quick = false;
        self.kind = kind;
        let d = sign(dir);
        self.dir = if d.is_nan() { 0.0 } else { d };
        self.delay = match kind {
            DipKind::Tow => 0.0,
            DipKind::Bonk => 0.85,
        };
        self.hold = hold[0] + (hold[1] - hold[0]) * clamp(self.random.next(), 0.0, 1.0);
        self.hold_end = self.delay + DIP_SETTLE + self.hold;
    }
    pub fn cancel(&mut self) {
        if self.active && self.t < self.hold_end {
            self.hold_end = self.t;
            self.quick = true;
        }
    }
    pub fn step(&mut self, dt: f64, reduced: bool) -> DipOut {
        let dt = clamp(finite_or_zero(dt), 0.0, 0.1);
        let n = (dt * 240.0).ceil().max(1.0) as usize;
        let h = dt / n as f64;
        for _ in 0..n {
            let mut accel = 0.0;
            if self.active {
                self.t += h;
                let goal = if self.t >= self.delay && self.t < self.hold_end { DIP_DEPTH } else { 0.0 };
                let w = if goal > self.y {
                    DIP_DOWN
                } else if self.quick {
                    DIP_QUICK
                } else {
                    DIP_UP
                };
                accel = w * w * (goal - self.y) - 2.0 * w * self.v;
                self.v += accel * h;
                self.y = clamp(self.y + self.v * h, 0.0, DIP_DEPTH);
                if self.t > self.hold_end && self.y < 0.0015 && self.v.abs() < 0.01 {
                    self.y = 0.0;
                    self.v = 0.0;
                    self.active = false;
                }
            }
            if reduced {
                self.sway = 0.0;
                self.sway_velocity = 0.0;
                continue;
            }
            let a = -SWAY_OMEGA * SWAY_OMEGA * self.sway - 2.0 * SWAY_ZETA * SWAY_OMEGA * self.sway_velocity - SWAY_GAIN * accel;
            self.sway_velocity += a * h;
            self.sway = clamp(self.sway + self.sway_velocity * h, -SWAY_LIMIT, SWAY_LIMIT);
            if self.sway.abs() < 0.01 && self.sway_velocity.abs() < 0.05 {
                self.sway = 0.0;
                self.sway_velocity = 0.0;
            }
        }
        let mix = if self.active { clamp(self.y / DIP_DEPTH * 1.4, 0.0, 1.0) } else { 0.0 };
        DipOut {
            dip: if self.active { self.y } else { 0.0 },
            dip_mix: mix,
            dip_dir: if self.active { self.dir } else { 0.0 },
            dip_kind: if self.active && self.kind == DipKind::Bonk { 1.0 } else { 0.0 },
            ahoge_sway: self.sway,
        }
    }
}
