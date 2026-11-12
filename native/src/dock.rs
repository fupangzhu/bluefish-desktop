//! desktop/dock.cjs and drag.cjs: window geometry. All values are device-independent pixels.
use crate::util::js_round;

pub const VIEW_PAD: f64 = 0.35;
pub const MIN_SIZE: f64 = 150.0;
pub const MAX_SIZE: f64 = 460.0;
pub const DEFAULT_SIZE: f64 = 240.0;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

pub fn clamp_size(n: f64) -> f64 {
    if !n.is_finite() {
        return DEFAULT_SIZE;
    }
    js_round(n).clamp(MIN_SIZE, MAX_SIZE)
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub width: f64,
    pub height: f64,
    pub grip: f64,
}
pub fn layout(size: f64, docked: bool) -> Layout {
    let s = clamp_size(size);
    if !docked {
        let w = js_round(s * (1.0 + 2.0 * VIEW_PAD));
        return Layout { width: w, height: w, grip: 0.0 };
    }
    let grip = js_round(s * 0.05);
    Layout { width: js_round(s * (1.3 + 2.0 * VIEW_PAD)), height: js_round(s * (0.70 + VIEW_PAD)) + grip, grip }
}
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if hi < lo {
        lo
    } else {
        hi.min(lo.max(v))
    }
}
/// Docked: the bottom edge sits `grip` px below the work-area bottom (over the taskbar top).
pub fn docked_bounds(work: Rect, display: Rect, size: f64, center_x: f64) -> Rect {
    let l = layout(size, true);
    let legacy = js_round(clamp_size(size) * 1.3);
    let cx = clamp(center_x, display.x + legacy / 2.0, display.x + display.width - legacy / 2.0);
    let x = js_round(cx - l.width / 2.0);
    Rect::new(x, work.y + work.height + l.grip - l.height, l.width, l.height)
}
pub fn free_bounds(work: Rect, size: f64, center: (f64, f64)) -> Rect {
    let l = layout(size, false);
    let s = clamp_size(size);
    Rect::new(
        js_round(clamp(center.0, work.x + s / 2.0, work.x + work.width - s / 2.0) - l.width / 2.0),
        js_round(clamp(center.1, work.y + s / 2.0, work.y + work.height - s / 2.0) - l.height / 2.0),
        l.width,
        l.height,
    )
}
/// Window x range a docked pet can occupy on one display.
pub fn dock_range(work: Rect, display: Rect, size: f64) -> (f64, f64) {
    (docked_bounds(work, display, size, -1e9).x, docked_bounds(work, display, size, 1e9).x)
}
const WALL_ZONE: f64 = 0.45;
const REACH_LEFT: f64 = 0.37;
const REACH_RIGHT: f64 = 0.4;
/// Which screen edge the docked head rests near (-1 left, 1 right, 0 none) and the gap to it.
/// An edge shared with another display is not a wall.
pub fn wall_info(bounds: Rect, display: Rect, size: f64, others: &[Rect]) -> (f64, f64) {
    let s = clamp_size(size);
    let cx = bounds.x + bounds.width / 2.0;
    let y = display.y + display.height - 2.0;
    let open = |x: f64| !others.iter().any(|d| d.contains(x, y));
    let left = cx - s * REACH_LEFT - display.x;
    let right = display.x + display.width - (cx + s * REACH_RIGHT);
    if left <= right && left <= s * WALL_ZONE && open(display.x - 2.0) {
        return (-1.0, js_round(left).max(0.0));
    }
    if right < left && right <= s * WALL_ZONE && open(display.x + display.width + 1.0) {
        return (1.0, js_round(right).max(0.0));
    }
    (0.0, 0.0)
}
pub fn home_center_x(work: Rect) -> f64 {
    work.x + work.width * 0.2
}
/// dy: cursor y since the drag started (negative = up).
pub fn should_undock(dy: f64, size: f64) -> bool {
    dy < -(60f64.max(clamp_size(size) * 0.35))
}
pub fn should_dock(bounds: Rect, work: Rect, size: Option<f64>) -> bool {
    let bottom = match size {
        Some(s) => bounds.y + bounds.height / 2.0 + clamp_size(s) / 2.0,
        None => bounds.y + bounds.height,
    };
    bottom - (work.y + work.height) > -24.0
}
/// Popup placement: open down/right of the point, flip up/left when it would overflow, clamp.
pub fn popup_position(point: (f64, f64), w: f64, h: f64, work: Rect) -> Rect {
    let (right, bottom) = (work.x + work.width, work.y + work.height);
    let x = if point.0 + w > right { point.0 - w } else { point.0 };
    let y = if point.1 + h > bottom { point.1 - h } else { point.1 };
    Rect::new(clamp(js_round(x), work.x, right - w), clamp(js_round(y), work.y, bottom - h), w, h)
}

// ---- drag.cjs -------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug)]
pub struct Drag {
    pub point: (f64, f64),
    pub bounds: Rect,
    pub active: bool,
    pub lock_y: bool,
}
impl Drag {
    pub fn new(point: (f64, f64), bounds: Rect, lock_y: bool) -> Drag {
        Drag { point, bounds, active: false, lock_y }
    }
    /// The window bounds for this cursor position, or None while within the 5 px dead zone or
    /// when nothing would change. `size`: the computed window size (never the native one).
    pub fn bounds_for(&mut self, point: (f64, f64), current: Rect, size: Layout) -> Option<Rect> {
        let (dx, dy) = (point.0 - self.point.0, point.1 - self.point.1);
        if !self.active && dx.hypot(dy) < 5.0 {
            return None;
        }
        self.active = true;
        let next = Rect::new(
            js_round(self.bounds.x + dx),
            js_round(self.bounds.y + if self.lock_y { 0.0 } else { dy }),
            size.width,
            size.height,
        );
        if next.x == current.x && next.y == current.y && (next.width - current.width).abs() <= 1.0 && (next.height - current.height).abs() <= 1.0 {
            return None;
        }
        Some(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const DISPLAY: Rect = Rect::new(0.0, 0.0, 1920.0, 1080.0);
    const WORK: Rect = Rect::new(0.0, 0.0, 1920.0, 1040.0);
    #[test]
    fn sizes_and_layouts() {
        assert_eq!(clamp_size(100.0), 150.0);
        assert_eq!(clamp_size(999.0), 460.0);
        assert_eq!(clamp_size(300.4), 300.0);
        assert_eq!(clamp_size(f64::NAN), 240.0);
        assert_eq!(layout(240.0, true), Layout { width: 480.0, height: 264.0, grip: 12.0 });
        assert_eq!(layout(150.0, true), Layout { width: 300.0, height: 165.0, grip: 8.0 });
        assert_eq!(layout(460.0, true), Layout { width: 920.0, height: 506.0, grip: 23.0 });
        assert_eq!(layout(240.0, false), Layout { width: 408.0, height: 408.0, grip: 0.0 });
    }
    #[test]
    fn docked_and_free_bounds() {
        assert_eq!(docked_bounds(WORK, DISPLAY, 240.0, 500.0), Rect::new(260.0, 788.0, 480.0, 264.0));
        assert_eq!(docked_bounds(WORK, DISPLAY, 240.0, -500.0).x, -84.0);
        assert_eq!(docked_bounds(WORK, DISPLAY, 240.0, 99999.0).x, 1920.0 - 396.0);
        assert_eq!(free_bounds(WORK, 240.0, (500.0, 500.0)), Rect::new(296.0, 296.0, 408.0, 408.0));
        assert_eq!(free_bounds(WORK, 240.0, (-50.0, -50.0)), Rect::new(-84.0, -84.0, 408.0, 408.0));
        assert_eq!(home_center_x(WORK), 384.0);
    }
    #[test]
    fn dock_and_undock_thresholds() {
        assert!(!should_undock(-59.0, 150.0));
        assert!(should_undock(-61.0, 150.0));
        assert!(!should_undock(-100.0, 460.0));
        assert!(should_undock(-162.0, 460.0));
        let at = |bottom: f64| Rect::new(0.0, bottom - 240.0, 240.0, 240.0);
        assert!(should_dock(at(1040.0), WORK, None));
        assert!(should_dock(at(1017.0), WORK, None));
        assert!(!should_dock(at(1016.0), WORK, None));
    }
    #[test]
    fn drag_dead_zone_and_lock() {
        let mut d = Drag::new((100.0, 100.0), Rect::new(0.0, 500.0, 480.0, 264.0), true);
        let l = layout(240.0, true);
        assert!(d.bounds_for((103.0, 102.0), Rect::new(0.0, 500.0, 480.0, 264.0), l).is_none());
        assert_eq!(d.bounds_for((150.0, 40.0), Rect::new(0.0, 500.0, 480.0, 264.0), l), Some(Rect::new(50.0, 500.0, 480.0, 264.0)));
    }
    #[test]
    fn walls() {
        let b = docked_bounds(WORK, DISPLAY, 240.0, -1e9);
        assert_eq!(wall_info(b, DISPLAY, 240.0, &[]).0, -1.0);
        let b = docked_bounds(WORK, DISPLAY, 240.0, 1e9);
        assert_eq!(wall_info(b, DISPLAY, 240.0, &[]).0, 1.0);
        let b = docked_bounds(WORK, DISPLAY, 240.0, 960.0);
        assert_eq!(wall_info(b, DISPLAY, 240.0, &[]), (0.0, 0.0));
        // A neighbouring display on the right: that edge is not a wall.
        let b = docked_bounds(WORK, DISPLAY, 240.0, 1e9);
        assert_eq!(wall_info(b, DISPLAY, 240.0, &[Rect::new(1920.0, 0.0, 1920.0, 1080.0)]).0, 0.0);
    }
}
