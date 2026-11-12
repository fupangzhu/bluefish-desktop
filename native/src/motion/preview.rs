//! preview.mjs: the editor's deterministic animation previews on the production Motion: a fixed
//! set-up per preview, fixed random draws, then playback, seeking and scrubbing.
use super::attention::AttentionInput;
use super::touch::{Grip, Point};
use super::tow::DipKind;
use super::Motion;
use crate::util::{smooth, Pt, Rand};

pub const PREVIEWS: [(&str, &str, f64); 20] = [
    ("snub_l", "向左侧瞥", 4.5),
    ("snub_r", "向右侧瞥", 4.5),
    ("normal", "正常醒来", 6.0),
    ("peek", "假醒", 4.0),
    ("rub_l", "左手揉眼", 6.0),
    ("rub_r", "右手揉眼", 6.0),
    ("ear_l", "左耳短抖", 1.2),
    ("ear_r", "右耳短抖", 1.2),
    ("sleep", "睡眠", 65.0),
    ("breath", "慢呼吸", 22.0),
    ("hair_ltr", "呆毛左→右", 7.2),
    ("hair_rtl", "呆毛右→左", 7.2),
    ("blink", "眨眼", 1.0),
    ("fringe", "轻拨刘海", 3.0),
    ("tug_guard", "拽呆毛护头", 2.5),
    ("bonk", "双击捂头下躲", 5.6),
    ("tow", "拽呆毛走", 8.8),
    ("dip", "拽走后下躲", 4.4),
    ("slump_l", "靠左墙发呆", 11.6),
    ("slump_r", "靠右墙发呆", 11.6),
];
/// The ahoge tip, art pixels: where the tow preview's virtual pointer pinches.
pub const TOW_GRIP: Pt = Pt::new(1535.0, 280.0);
/// The tow preview's pointer path (px at 240): bend, straighten, drag away, coast, ease back, let go.
const TOW_PATH: [(f64, f64, f64); 9] = [(0.0, 0.0, 0.0), (0.4, 8.0, -2.0), (0.7, 8.0, -2.0), (1.3, 30.0, -4.0), (1.6, 30.0, -4.0), (3.0, 200.0, -6.0), (3.6, 200.0, -6.0), (4.0, 165.0, -5.0), (4.3, 165.0, -5.0)];
const DRAG_SEGMENT: usize = 5;

pub fn tow_pointer(time: f64) -> Option<(f64, f64)> {
    for i in 1..TOW_PATH.len() {
        let (a, b) = (TOW_PATH[i - 1], TOW_PATH[i]);
        if time <= b.0 {
            let u = (time - a.0) / (b.0 - a.0);
            let k = if i == DRAG_SEGMENT { u } else { u * u * (3.0 - 2.0 * u) };
            return Some((a.1 + (b.1 - a.1) * k, a.2 + (b.2 - a.2) * k));
        }
    }
    None
}

struct Saved {
    follow: bool,
    idle: bool,
    wake: Rand,
    doze: Rand,
    lids: Rand,
    reluctant: Rand,
    touch: Rand,
    dip: Rand,
    slump: Rand,
}

pub struct Preview {
    pub active: bool,
    pub playing: bool,
    pub time: f64,
    pub duration: f64,
    pub rate: f64,
    pub name: &'static str,
    original: Option<Saved>,
    pub base_pose: (f64, f64, f64),
}
impl Default for Preview {
    fn default() -> Self {
        Preview { active: false, playing: false, time: 0.0, duration: 0.0, rate: 1.0, name: "", original: None, base_pose: (0.0, 0.0, 0.0) }
    }
}
fn input0() -> AttentionInput {
    AttentionInput { now: 0.0, ..AttentionInput::default() }
}
impl Preview {
    pub fn select(&mut self, m: &mut Motion, name: &str) -> Result<(), String> {
        let Some(&(key, _, duration)) = PREVIEWS.iter().find(|p| p.0 == name) else { return Err("Unknown preview".into()) };
        if !self.active {
            self.original = Some(Saved {
                follow: m.follow,
                idle: m.idle,
                wake: m.wake.random.clone(),
                doze: m.doze.random.clone(),
                lids: m.eyelids.random.clone(),
                reluctant: m.attention.reluctance.random.clone(),
                touch: m.touch.random.clone(),
                dip: m.touch.dip.random.clone(),
                slump: m.slump.random.clone(),
            });
        }
        self.base_pose = m.pose;
        self.name = key;
        self.duration = duration;
        self.rate = if key.starts_with("ear_") {
            0.25
        } else if key == "sleep" || key == "breath" {
            4.0
        } else {
            1.0
        };
        self.active = true;
        self.playing = true;
        self.initialize(m);
        Ok(())
    }
    fn initialize(&mut self, m: &mut Motion) {
        let o = self.original.as_ref().unwrap();
        m.attention.reluctance.random = o.reluctant.clone();
        let half = Rand::fixed(0.5);
        m.touch.random = half.clone();
        m.touch.dip.random = half.clone();
        m.slump.random = half.clone();
        m.wall = (0.0, 0.0);
        m.wake.random = half.clone();
        m.doze.random = half.clone();
        m.eyelids.random = half;
        m.reset();
        m.time = 0.0;
        m.next_blink = f64::INFINITY;
        m.pose = self.base_pose;
        m.follow = false;
        m.idle = true;
        m.over = None;
        for s in m.springs.iter_mut() {
            s.value = 0.0;
            s.velocity = 0.0;
        }
        self.time = 0.0;
        let name = self.name;
        let step0 = |m: &mut Motion, i: AttentionInput| {
            m.attention.update(0.0, &i, &mut m.wake);
            m.step(0.0);
        };
        if name.starts_with("snub_") {
            m.attention.reluctance.random = Rand::fixed(0.0);
            m.attention.droop = 1.0;
            m.attention.last_near = -30.0;
            m.springs[super::DROOP].value = 1.0;
            m.springs[super::EARS].value = -1.0;
            step0(m, input0());
            step0(m, AttentionInput { x: 120.0, y: 110.0, size: 240.0, near: true, hx: if name == "snub_l" { 1.0 } else { -1.0 }, ..input0() });
        } else if !["blink", "fringe", "tug_guard", "bonk", "dip", "slump_l", "slump_r", "tow"].contains(&name) {
            let s = &mut m.attention.sleep_controller;
            s.sleeping = true;
            s.closure = 1.0;
            s.depth = 1.0;
            m.attention.droop = 1.0;
            m.springs[super::PITCH].value = 3.0;
            m.springs[super::DROOP].value = 1.0;
            m.springs[super::EARS].value = -1.0;
            step0(m, input0());
            m.doze.next_ear = f64::INFINITY;
            m.doze.next_side = f64::INFINITY;
            m.doze.breath_period = 20.0;
            m.doze.sway_period = 40.0;
            if ["normal", "rub_l", "rub_r", "peek"].contains(&name) {
                let draw = match name {
                    "normal" => 0.1,
                    "rub_l" => 0.66,
                    "rub_r" => 0.8,
                    _ => 0.95,
                };
                m.wake.random = Rand::fixed(draw);
                step0(m, AttentionInput { wake: true, ..input0() });
            } else if name.starts_with("ear_") {
                m.doze.twitch(name.ends_with('l'), 1.0 / 60.0);
            } else if name.starts_with("hair") {
                let from = if name == "hair_rtl" { 1.0 } else { -1.0 };
                m.doze.side = from;
                m.doze.side_target = from;
                m.doze.lean = from;
                m.springs[super::SIDE].value = from;
                m.doze.next_side = 0.3;
                m.step(0.0);
            } else if name == "sleep" {
                m.doze.next_ear = 20.0;
                m.doze.next_side = 35.0;
            }
        } else {
            step0(m, input0());
            match name {
                "blink" => m.blink(),
                "bonk" => {
                    m.touch.start_bonk();
                }
                "dip" => m.touch.dip.start(1.0, DipKind::Tow),
                "tow" => {
                    let grip = Grip { source: TOW_GRIP, binding: None, outline: None, relative: true };
                    m.touch.start_pull(Point::new(0.0, 0.0, 0.0, 0.0), Some(&grip), true, 240.0);
                }
                "slump_l" | "slump_r" => {
                    let side = if name == "slump_l" { -1.0 } else { 1.0 };
                    m.wall = (side, 36.0);
                    m.slump.begin(side);
                }
                "tug_guard" => {
                    let grip = Grip { source: TOW_GRIP, binding: None, outline: None, relative: true };
                    m.touch.start_pull(Point::local(0.0, 0.0), Some(&grip), false, 240.0);
                }
                _ => {
                    m.idle = false;
                    m.touch.fringe.start(Pt::new(0.0, 0.0), 240.0, Some(Pt::new(1100.0, 1000.0)));
                }
            }
        }
    }
    fn advance(&mut self, m: &mut Motion, target: f64) {
        while self.time < target - 1e-8 {
            let dt = (1.0 / 60.0f64).min(target - self.time);
            self.time += dt;
            let t = self.time;
            match self.name {
                "fringe" => {
                    if t < 1.2 {
                        let k = smooth((t / 0.7).min(1.0));
                        m.touch.fringe.move_to(Pt::new(14.0 * k, -3.0 * k));
                    } else {
                        m.touch.fringe.end();
                    }
                }
                "tow" => match tow_pointer(t) {
                    Some((x, y)) => m.touch.move_pull(Point::new(x, y, x, y), 240.0),
                    None => m.touch.end_pull(),
                },
                "tug_guard" => {
                    if t < 1.4 {
                        let k = smooth((t / 0.55).min(1.0));
                        m.touch.move_pull(Point::local(15.0 * k, -46.0 * k), 240.0);
                    } else {
                        m.touch.end_pull();
                    }
                }
                _ => {}
            }
            let i = AttentionInput { now: t, reduced: m.reduced, ..AttentionInput::default() };
            m.attention.update(dt, &i, &mut m.wake);
            m.step(dt);
        }
    }
    pub fn step(&mut self, m: &mut Motion, dt: f64) {
        if self.active && self.playing {
            let target = self.duration.min(self.time + dt.max(0.0) * self.rate);
            self.advance(m, target);
            if self.time >= self.duration - 1e-8 {
                self.playing = false;
            }
        }
    }
    pub fn seek(&mut self, m: &mut Motion, time: f64) {
        if !self.active {
            return;
        }
        let playing = self.playing;
        self.initialize(m);
        self.advance(m, time.clamp(0.0, self.duration));
        self.playing = playing && self.time < self.duration;
    }
    pub fn release(&mut self, m: &mut Motion) {
        if !self.active {
            return;
        }
        if self.name == "fringe" {
            m.touch.fringe.end();
        }
        if self.name == "tug_guard" || self.name == "tow" {
            m.touch.end_pull();
        }
        if let Some(o) = self.original.take() {
            m.wake.random = o.wake;
            m.doze.random = o.doze;
            m.eyelids.random = o.lids;
            m.attention.reluctance.random = o.reluctant;
            m.touch.random = o.touch;
            m.touch.dip.random = o.dip;
            m.slump.random = o.slump;
            m.follow = o.follow;
            m.idle = o.idle;
        }
        m.wall = (0.0, 0.0);
        m.attention.last_clock = None;
        m.next_blink = m.time + 3.0;
        self.active = false;
        self.playing = false;
    }
    /// The tow carries the whole head sideways in the editor (px at 240).
    pub fn stage_shift(&self, m: &Motion) -> f64 {
        if self.active && self.name == "tow" {
            m.touch.tow.offset - 85.0
        } else {
            0.0
        }
    }
    /// The tow preview's virtual pointer relative to the pinched point (px at 240), while held.
    pub fn pointer(&self, m: &Motion) -> Option<(f64, f64)> {
        if !self.active || self.name != "tow" || m.touch.anchor.is_none() {
            return None;
        }
        tow_pointer(self.time).map(|(x, y)| (x - m.touch.tow.offset, y))
    }
    pub fn stop(&mut self, m: &mut Motion) {
        self.release(m);
        m.reset();
    }
}
