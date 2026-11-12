//! ahoge.mjs: the vector ahoge (a five-control quadratic B-spline ribbon), its material binding,
//! the pull solver and the spring-back.
use crate::util::{clamp, Pt};
use std::sync::LazyLock;

pub type Outline = [[Pt; 5]; 2];

const DEGREE: usize = 2;
const KNOTS: [f64; 8] = [0.0, 0.0, 0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0, 1.0, 1.0];
pub const ROOT: Pt = Pt::new(1143.222, 503.018);
pub const COLOR_TOP: [f64; 3] = [65.0, 105.0, 231.0];
pub const COLOR_ROOT: [f64; 3] = [39.0, 76.0, 193.0];
pub const CONTROL: [Pt; 5] = [
    Pt::new(1143.222, 503.018),
    Pt::new(1068.222, 293.018),
    Pt::new(1336.7885, 92.9332),
    Pt::new(1541.3577, 225.3975),
    Pt::new(1495.0, 365.0),
];
const RADII: [f64; 5] = [2.8, 30.0, 40.0, 32.0, 0.0];
const SAMPLES: usize = 96;
pub const REST_COUNT: usize = 80;
const LAST: f64 = (REST_COUNT - 1) as f64;
const INFLUENCE: [f64; 5] = [0.0, 0.0, 0.55, 1.0, 1.0];
const OVERSHOOT: f64 = 35.0;
pub const TAUT_FROM: f64 = 0.7;
pub const TAUT_TO: f64 = 1.0;
pub const TAUT_ENGAGE: f64 = 1.04;
pub const TAUT_MAX: f64 = 1.1;

#[inline]
fn mix(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
#[inline]
fn lerp(a: Pt, b: Pt, t: f64) -> Pt {
    Pt::new(mix(a.x, b.x, t), mix(a.y, b.y, t))
}
#[inline]
fn distance(a: Pt, b: Pt) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
#[inline]
fn unit(x: f64, y: f64) -> Pt {
    let n = x.hypot(y);
    let n = if n == 0.0 || n.is_nan() { 1.0 } else { n };
    Pt::new(x / n, y / n)
}
#[inline]
fn sub(a: Pt, b: Pt) -> Pt {
    Pt::new(a.x - b.x, a.y - b.y)
}
#[inline]
fn cross(a: Pt, b: Pt) -> f64 {
    a.x * b.y - a.y * b.x
}
#[inline]
fn dot(a: Pt, b: Pt) -> f64 {
    a.x * b.x + a.y * b.y
}
#[inline]
fn turn(a: Pt, b: Pt) -> f64 {
    cross(a, b).atan2(dot(a, b)).abs()
}
#[inline]
fn len(p: Pt) -> f64 {
    p.x.hypot(p.y)
}

/// De Boor evaluation (any degree, any knot vector), as in the JS `spline()`.
fn spline_with(points: &[Pt], t: f64, degree: usize, knots: &[f64]) -> Pt {
    let t = clamp(t, 0.0, 1.0);
    let mut span = degree;
    while span < points.len() - 1 && t >= knots[span + 1] {
        span += 1;
    }
    let mut d: [Pt; 3] = [Pt::default(); 3];
    for i in 0..=degree {
        d[i] = points[span - degree + i];
    }
    for r in 1..=degree {
        for j in (r..=degree).rev() {
            let k = span - degree + j;
            let a = (t - knots[k]) / (knots[j + 1 + span - r] - knots[k]);
            d[j] = lerp(d[j - 1], d[j], a);
        }
    }
    d[degree]
}
pub fn spline(points: &[Pt; 5], t: f64) -> Pt {
    spline_with(points, t, DEGREE, &KNOTS)
}
fn derivative(points: &[Pt; 5], t: f64) -> Pt {
    let mut d = [Pt::default(); 4];
    for i in 0..4 {
        let f = DEGREE as f64 / (KNOTS[i + DEGREE + 1] - KNOTS[i + 1]);
        d[i] = Pt::new((points[i + 1].x - points[i].x) * f, (points[i + 1].y - points[i].y) * f);
    }
    spline_with(&d, t, DEGREE - 1, &KNOTS[1..KNOTS.len() - 1])
}

pub static EDGES: LazyLock<Outline> = LazyLock::new(|| {
    let mut out = [[Pt::default(); 5]; 2];
    for (e, side) in [-1.0f64, 1.0].into_iter().enumerate() {
        for i in 0..5 {
            let a = CONTROL[(i as usize).saturating_sub(1)];
            let b = CONTROL[(i + 1).min(4)];
            let n = unit(a.y - b.y, b.x - a.x);
            let p = CONTROL[i];
            out[e][i] = Pt::new(p.x + n.x * RADII[i] * side, p.y + n.y * RADII[i] * side);
        }
    }
    out
});
pub static REST: LazyLock<[Pt; REST_COUNT]> = LazyLock::new(|| {
    let mut out = [Pt::default(); REST_COUNT];
    for (i, p) in out.iter_mut().enumerate() {
        *p = spline(&CONTROL, i as f64 / 79.0);
    }
    out
});
pub fn ahoge_edges(t: f64) -> [Pt; 2] {
    [spline(&EDGES[0], t), spline(&EDGES[1], t)]
}
pub fn ahoge_rest_angle(droop: f64, side: f64) -> f64 {
    let v = clamp(droop, 0.0, 1.0) * (160.0 - 85.0 * clamp(side, -1.0, 1.0));
    if v.is_nan() {
        0.0
    } else {
        v
    }
}

/// Material coordinate shared by the outlines and the rendered mesh.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Binding {
    pub t: f64,
    pub along: f64,
    pub across: f64,
    pub u: Option<f64>,
}
fn binding_at(point: Pt, t: f64) -> Binding {
    let u = t / LAST;
    let p = spline(&CONTROL, u);
    let d = derivative(&CONTROL, u);
    let dir = unit(d.x, d.y);
    let (dx, dy) = (point.x - p.x, point.y - p.y);
    Binding { t, along: dx * dir.x + dy * dir.y, across: -dx * dir.y + dy * dir.x, u: None }
}
pub fn bind_ahoge(point: Pt) -> Binding {
    let rest = &*REST;
    let (mut best, mut t) = (f64::INFINITY, 0.0);
    for i in 0..REST_COUNT - 1 {
        let (a, b) = (rest[i], rest[i + 1]);
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let u = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0.0, 1.0);
        let d = distance(point, lerp(a, b, u));
        if d < best {
            best = d;
            t = i as f64 + u;
        }
    }
    binding_at(point, t)
}
pub fn deform_ahoge(binding: &Binding, outline: Option<&Outline>) -> Pt {
    let t = binding.t / LAST;
    let outline = outline.unwrap_or(&EDGES);
    if let Some(u) = binding.u.filter(|u| u.is_finite()) {
        return lerp(spline(&outline[0], t), spline(&outline[1], t), u);
    }
    let p = lerp(spline(&outline[0], t), spline(&outline[1], t), 0.5);
    let d = derivative(&CONTROL, t);
    let dir = unit(d.x, d.y);
    Pt::new(p.x + dir.x * binding.along - dir.y * binding.across, p.y + dir.y * binding.along + dir.x * binding.across)
}

// ---- stretch checks -------------------------------------------------------------------------
fn basis(t: f64) -> [f64; 5] {
    let mut out = [0.0; 5];
    for (k, o) in out.iter_mut().enumerate() {
        let mut pts = [Pt::default(); 5];
        pts[k].x = 1.0;
        *o = spline(&pts, t).x;
    }
    out
}
fn eval_point(controls: &[Pt; 5], b: &[f64; 5]) -> Pt {
    let mut p = Pt::default();
    for i in 0..5 {
        p.x += b[i] * controls[i].x;
        p.y += b[i] * controls[i].y;
    }
    p
}
struct Row {
    b: [f64; 5],
}
struct Reference {
    steps: [Pt; 2],
    total: f64,
    signs: [f64; 2],
}
struct Tables {
    rows: Vec<Row>,
    reference: Vec<Reference>,
    rest_length: f64,
    arc: Vec<f64>,
    straight: [f64; 5],
}
static TABLES: LazyLock<Tables> = LazyLock::new(|| {
    let rows: Vec<Row> = (0..=SAMPLES).map(|i| Row { b: basis(i as f64 / SAMPLES as f64) }).collect();
    let rest_rows: Vec<[Pt; 2]> = (0..=SAMPLES).map(|i| ahoge_edges(i as f64 / SAMPLES as f64)).collect();
    let mut reference = Vec::with_capacity(SAMPLES);
    let mut rest_length = 0.0;
    for i in 1..=SAMPLES {
        let (a, b) = (rest_rows[i - 1], rest_rows[i]);
        let steps = [sub(b[0], a[0]), sub(b[1], a[1])];
        rest_length += len(lerp(steps[0], steps[1], 0.5));
        reference.push(Reference {
            steps,
            total: rest_length,
            signs: [cross(sub(a[1], a[0]), steps[0]), cross(steps[1], sub(b[0], a[1]))],
        });
    }
    // Rest arc length along the centre line, tabulated by spline parameter.
    let n = 960;
    let mut arc = vec![0.0];
    let (mut total, mut prev) = (0.0, spline(&CONTROL, 0.0));
    for i in 1..=n {
        let p = spline(&CONTROL, i as f64 / n as f64);
        total += distance(prev, p);
        prev = p;
        arc.push(total);
    }
    let arc_at = |u: f64| {
        let x = clamp(u, 0.0, 1.0) * (arc.len() - 1) as f64;
        let i = ((arc.len() - 2) as f64).min(x.floor()) as usize;
        mix(arc[i], arc[i + 1], x - i as f64)
    };
    // Collinear controls whose spline reproduces the rest arc-length distribution (least squares, c0 = 0).
    const M: usize = 4;
    let mut a = [[0.0f64; M + 1]; M];
    for j in 0..=96 {
        let u = j as f64 / 96.0;
        let bb = basis(u);
        let b = &bb[1..];
        let y = arc_at(u);
        for r in 0..M {
            for c in 0..M {
                a[r][c] += b[r] * b[c];
            }
            a[r][M] += b[r] * y;
        }
    }
    for i in 0..M {
        let mut p = i;
        for r in i + 1..M {
            if a[r][i].abs() > a[p][i].abs() {
                p = r;
            }
        }
        a.swap(i, p);
        for r in 0..M {
            if r != i {
                let f = a[r][i] / a[i][i];
                for c in i..=M {
                    a[r][c] -= f * a[i][c];
                }
            }
        }
    }
    let mut straight = [0.0; 5];
    for i in 0..M {
        straight[i + 1] = a[i][M] / a[i][i];
    }
    Tables { rows, reference, rest_length, arc, straight }
});
fn arc_at(u: f64) -> f64 {
    let arc = &TABLES.arc;
    let x = clamp(u, 0.0, 1.0) * (arc.len() - 1) as f64;
    let i = ((arc.len() - 2) as f64).min(x.floor()) as usize;
    mix(arc[i], arc[i + 1], x - i as f64)
}
pub fn rest_length() -> f64 {
    TABLES.rest_length
}

fn outline_stretch(outline: &Outline) -> Option<f64> {
    let tb = &*TABLES;
    let row = |i: usize| [eval_point(&outline[0], &tb.rows[i].b), eval_point(&outline[1], &tb.rows[i].b)];
    let (mut total, mut stretch) = (0.0, 0.0);
    let mut prior: Option<[Pt; 2]> = None;
    let mut a = row(0);
    for i in 1..=SAMPLES {
        let b = row(i);
        let steps = [sub(b[0], a[0]), sub(b[1], a[1])];
        let rf = &tb.reference[i - 1];
        let signs = [cross(sub(a[1], a[0]), steps[0]), cross(steps[1], sub(b[0], a[1]))];
        for j in 0..2 {
            if rf.signs[j].abs() > 0.001 && signs[j] * rf.signs[j] <= 0.0 {
                return None;
            }
        }
        for j in 0..2 {
            if len(steps[j]) < 0.36 * len(rf.steps[j]) {
                return None;
            }
            if let Some(pr) = prior {
                if turn(pr[j], steps[j]) > 0.085f64.max(1.6 * turn(tb.reference[i - 2].steps[j], rf.steps[j])) {
                    return None;
                }
            }
        }
        total += len(lerp(steps[0], steps[1], 0.5));
        prior = Some(steps);
        stretch = f64::max(stretch, total / rf.total - 1.0);
        if stretch > 0.18 {
            return None;
        }
        a = b;
    }
    Some(stretch)
}
fn move_outline(outline: &Outline, dx: f64, dy: f64) -> Outline {
    let mut out = *outline;
    for edge in out.iter_mut() {
        for (i, p) in edge.iter_mut().enumerate() {
            p.x += dx * INFLUENCE[i];
            p.y += dy * INFLUENCE[i];
        }
    }
    out
}
struct Safe {
    outline: Outline,
    stretch: f64,
    fraction: f64,
}
fn last_safe(candidate: impl Fn(f64) -> Outline, max: f64) -> Safe {
    let mut best = candidate(0.0);
    let mut stretch = outline_stretch(&best).unwrap_or(0.0);
    let mut low = 0.0;
    for i in 1..=8 {
        let step = max * i as f64 / 8.0;
        let outline = candidate(step);
        if let Some(check) = outline_stretch(&outline) {
            best = outline;
            stretch = check;
            low = step;
            continue;
        }
        let mut high = step;
        for _ in 0..12 {
            let mid = (low + high) / 2.0;
            let next = candidate(mid);
            match outline_stretch(&next) {
                None => high = mid,
                Some(v) => {
                    low = mid;
                    best = next;
                    stretch = v;
                }
            }
        }
        break;
    }
    Safe { outline: best, stretch, fraction: low }
}
fn angle_of(v: Pt) -> f64 {
    v.y.atan2(v.x)
}
fn turn_vec(v: Pt, a: f64) -> Pt {
    Pt::new(v.x * a.cos() - v.y * a.sin(), v.x * a.sin() + v.y * a.cos())
}
fn curl_blend(a: &Outline, b: &Outline, f: f64) -> Outline {
    let mut out = [[Pt::default(); 5]; 2];
    for i in 0..5 {
        let ca = lerp(a[0][i], a[1][i], 0.5);
        let cb = lerp(b[0][i], b[1][i], 0.5);
        let (va, vb) = (sub(ca, ROOT), sub(cb, ROOT));
        let (ra, rb) = (len(va), len(vb));
        let mut d = if ra > 1e-6 && rb > 1e-6 { angle_of(vb) - angle_of(va) } else { 0.0 };
        d = d.sin().atan2(d.cos());
        let r = mix(ra, rb, f);
        let ang = if ra > 1e-6 { angle_of(va) + d * f } else { angle_of(vb) };
        let centre = if r > 1e-6 { Pt::new(ROOT.x + ang.cos() * r, ROOT.y + ang.sin() * r) } else { lerp(ca, cb, f) };
        let ha = turn_vec(sub(a[1][i], ca), d * f);
        let hb = turn_vec(sub(b[1][i], cb), -d * (1.0 - f));
        let half = Pt::new(ha.x * (1.0 - f) + hb.x * f, ha.y * (1.0 - f) + hb.y * f);
        out[0][i] = sub(centre, half);
        out[1][i] = Pt::new(centre.x + half.x, centre.y + half.y);
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Bend,
    Resist,
    Straighten,
    Taut,
}
#[derive(Clone, Copy, Debug)]
pub struct AhogePose {
    pub outline: Outline,
    pub stretch: f64,
    pub saturated: bool,
    pub phase: Phase,
    pub taut: f64,
}
pub fn rebound_ahoge(pose: &AhogePose, strength: f64) -> AhogePose {
    let edges = &*EDGES;
    let blend = |f: f64| {
        let mut out = *edges;
        for j in 0..2 {
            for i in 0..5 {
                out[j][i] = lerp(edges[j][i], pose.outline[j][i], f);
            }
        }
        out
    };
    let mut f = strength;
    if f < 0.0 {
        let mut reach = f64::NEG_INFINITY;
        for j in 0..2 {
            for i in 0..5 {
                reach = reach.max(distance(pose.outline[j][i], edges[j][i]));
            }
        }
        if reach * -f > OVERSHOOT {
            f = -OVERSHOOT / reach;
        }
    }
    if pose.taut >= 0.5 {
        let outline = curl_blend(edges, &pose.outline, f);
        let stretch = outline_stretch(&outline).unwrap_or(f.max(0.0) * pose.stretch);
        return AhogePose { outline, stretch, ..*pose };
    }
    let outline = blend(f);
    if let Some(stretch) = outline_stretch(&outline) {
        return AhogePose { outline, stretch, ..*pose };
    }
    let safe = last_safe(|g| blend(g * f), 1.0);
    AhogePose { outline: safe.outline, stretch: safe.stretch, ..*pose }
}

fn straight_outline(dir: Pt, scale: f64) -> Outline {
    let n = Pt::new(-dir.y, dir.x);
    let st = &TABLES.straight;
    let mut out = [[Pt::default(); 5]; 2];
    for (e, side) in [-1.0f64, 1.0].into_iter().enumerate() {
        for i in 0..5 {
            let c = st[i];
            out[e][i] = Pt::new(
                ROOT.x + dir.x * c * scale + n.x * RADII[i] * side,
                ROOT.y + dir.y * c * scale + n.y * RADII[i] * side,
            );
        }
    }
    out
}
/// Rest vector from the root to a material point, and the strand length to it.
#[derive(Clone, Copy, Debug)]
pub struct Reach {
    pub x: f64,
    pub y: f64,
    pub arc: f64,
}
pub fn ahoge_reach(binding: &Binding) -> Reach {
    let t = clamp(binding.t / LAST, 0.0, 1.0);
    let p = deform_ahoge(binding, Some(&EDGES));
    Reach { x: p.x - ROOT.x, y: p.y - ROOT.y, arc: arc_at(t) }
}
pub fn solve_ahoge(source: Pt, target: Pt, strength: f64, base: Option<&Outline>, binding: Option<&Binding>) -> AhogePose {
    let base = *base.unwrap_or(&EDGES);
    let grip = binding.copied().unwrap_or_else(|| bind_ahoge(source));
    let t = clamp(grip.t / LAST, 0.0, 1.0);
    let start = deform_ahoge(&grip, Some(&base));
    let delta = sub(target, start);
    let d = len(delta);
    let leverage: f64 = basis(t).iter().zip(INFLUENCE).map(|(w, k)| w * k).sum();
    let cap = if d > 1e-8 { (rest_length() * 0.65 * leverage / d).min(1.0) } else { 0.0 };
    let result = if cap > 0.0 {
        last_safe(|f| move_outline(&base, delta.x * f / leverage, delta.y * f / leverage), cap)
    } else {
        Safe { outline: base, stretch: outline_stretch(&base).unwrap_or(0.0), fraction: 0.0 }
    };
    let saturated = d > 1e-8 && result.fraction < 0.999;
    let mut pose = AhogePose {
        outline: result.outline,
        stretch: result.stretch,
        saturated,
        phase: if saturated { Phase::Resist } else { Phase::Bend },
        taut: 0.0,
    };
    let arc = arc_at(t).max(1e-6);
    let away = sub(target, ROOT);
    let reach = len(away);
    let ratio = reach / arc;
    let from = TAUT_FROM.max(len(sub(start, ROOT)) / arc);
    let taut = crate::util::smooth((ratio - from) / 0.05f64.max(TAUT_TO - from));
    if taut > 0.0 && reach > 1e-6 {
        let mut dir = Pt::new(away.x / reach, away.y / reach);
        let mut scale = ratio.min(TAUT_MAX);
        let mut straight = straight_outline(dir, scale);
        for _ in 0..3 {
            let g = sub(deform_ahoge(&grip, Some(&straight)), ROOT);
            let gl = { let l = len(g); if l == 0.0 { 1.0 } else { l } };
            let a = cross(g, away).atan2(dot(g, away));
            let (c, s) = (a.cos(), a.sin());
            dir = Pt::new(dir.x * c - dir.y * s, dir.x * s + dir.y * c);
            scale = (scale * reach / gl).min(TAUT_MAX);
            straight = straight_outline(dir, scale);
        }
        let mut outline = if taut >= 1.0 { straight } else { curl_blend(&pose.outline, &straight, taut) };
        let over = ratio > TAUT_MAX;
        if !over && taut < 1.0 && leverage > 1e-6 {
            for _ in 0..4 {
                let e = sub(target, deform_ahoge(&grip, Some(&outline)));
                if len(e) < 0.05 {
                    break;
                }
                outline = move_outline(&outline, e.x / leverage, e.y / leverage);
            }
        }
        pose = AhogePose {
            outline,
            stretch: (scale - 1.0).max(0.0),
            saturated: over,
            phase: if over {
                Phase::Resist
            } else if taut >= 1.0 {
                Phase::Taut
            } else {
                Phase::Straighten
            },
            taut,
        };
    }
    if strength == 1.0 {
        pose
    } else {
        rebound_ahoge(&pose, strength)
    }
}

/// One mesh vertex of the ahoge strip: art position, uv, and its material binding.
#[derive(Clone, Copy, Debug)]
pub struct StripVertex {
    pub x: f64,
    pub y: f64,
    pub u: f64,
    pub v: f64,
    pub binding: Binding,
}
pub fn ahoge_geometry(segments: usize) -> Vec<StripVertex> {
    let mut rows = Vec::with_capacity(segments + 1);
    for i in 0..=segments {
        let u = i as f64 / segments as f64;
        let e = ahoge_edges(u);
        let row: [StripVertex; 2] = std::array::from_fn(|k| {
            let p = e[k];
            let mut b = binding_at(p, u * LAST);
            b.u = Some(k as f64);
            StripVertex { x: p.x, y: p.y, u: k as f64, v: u, binding: b }
        });
        rows.push(row);
    }
    let mut points = Vec::with_capacity(segments * 6);
    for i in 0..segments {
        points.extend_from_slice(&[rows[i][0], rows[i][1], rows[i + 1][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]]);
    }
    points
}
pub fn ahoge_bounds() -> [f64; 4] {
    let p = ahoge_geometry(256);
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for v in &p {
        x0 = x0.min(v.x);
        y0 = y0.min(v.y);
        x1 = x1.max(v.x);
        y1 = y1.max(v.y);
    }
    [x0.floor() - 2.0, y0.floor() - 2.0, x1.ceil() + 2.0, y1.ceil() + 2.0]
}
