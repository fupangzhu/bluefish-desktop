//! Small numeric helpers with JavaScript semantics, so the translated behaviour code
//! produces the same numbers as the JS it came from.
use std::cell::Cell;
use std::rc::Rc;

/// `Math.max(a, Math.min(b, v))`.
#[inline]
pub fn clamp(v: f64, a: f64, b: f64) -> f64 {
    a.max(b.min(v))
}
/// `u = clamp(u, 0, 1); u*u*(3-2u)`.
#[inline]
pub fn smooth(u: f64) -> f64 {
    let u = clamp(u, 0.0, 1.0);
    u * u * (3.0 - 2.0 * u)
}
/// `Math.sign`: 0 stays 0 (Rust's `signum` would give 1).
#[inline]
pub fn sign(v: f64) -> f64 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        v
    }
}
/// `Math.round`: halves round toward +infinity.
#[inline]
pub fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}
#[inline]
pub fn rad(d: f64) -> f64 {
    d * std::f64::consts::PI / 180.0
}
/// `Number.isFinite(v) ? v : 0`, the `dt` guard used by every step function.
#[inline]
pub fn finite_or_zero(v: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        0.0
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}
impl Pt {
    pub const fn new(x: f64, y: f64) -> Self {
        Pt { x, y }
    }
}

/// Shared random stream (mulberry32). Every behaviour module draws from the same stream, in the
/// same order as the JS, so a fixed seed reproduces the JS run exactly (see `golden/`).
#[derive(Clone)]
pub struct Rand(Rc<Cell<u32>>, Option<f64>);
impl Rand {
    pub fn new(seed: u32) -> Self {
        Rand(Rc::new(Cell::new(seed)), None)
    }
    /// Always the same draw (the editor's deterministic previews).
    pub fn fixed(v: f64) -> Self {
        Rand(Rc::new(Cell::new(0)), Some(v))
    }
    pub fn from_clock() -> Self {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9e37_79b9);
        Rand::new((n ^ (n >> 32)) as u32)
    }
    pub fn next(&self) -> f64 {
        if let Some(v) = self.1 {
            return v;
        }
        let a = self.0.get().wrapping_add(0x6D2B_79F5);
        self.0.set(a);
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}
