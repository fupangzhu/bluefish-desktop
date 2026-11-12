//! src/icons.mjs: the hand-drawn 24×24 stroke icons, parsed from the same SVG snippets into
//! figures of lines and cubic curves (arcs and circles converted), ready for any vector backend.
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Seg {
    Line(f64, f64),
    Cubic([f64; 6]),
}
#[derive(Clone, Debug, Default)]
pub struct Figure {
    pub start: (f64, f64),
    pub segs: Vec<Seg>,
    pub closed: bool,
}

pub const ICONS: &[(&str, &str)] = &[
    ("size", r#"<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>"#),
    ("yaw", r#"<path d="M4 15c4 3 12 3 16 0"/><path d="M4.8 18.4L4 15l3.5-.2M19.2 18.4L20 15l-3.5-.2"/><circle cx="12" cy="7.5" r="3"/>"#),
    ("pitch", r#"<path d="M15 4c3 4 3 12 0 16"/><path d="M14.8 7.5L15 4l3.4.8M14.8 16.5L15 20l3.4-.8"/><circle cx="7.5" cy="12" r="3"/>"#),
    ("roll", r#"<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/><path d="M10 14l4-4"/>"#),
    ("blink", r#"<path d="M3 10c4 5 14 5 18 0"/><path d="M12 15.5V18M6.2 13.6l-1.6 2M17.8 13.6l1.6 2"/>"#),
    ("wink", r#"<circle cx="7" cy="11" r="3"/><path d="M14 11c1.6 3 5.4 3 7 0"/><path d="M17.5 15.5V17.5"/>"#),
    ("nod", r#"<circle cx="12" cy="8" r="4"/><path d="M7 16l5 4 5-4"/>"#),
    ("shake", r#"<circle cx="12" cy="12" r="4"/><path d="M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>"#),
    ("happy", r#"<path d="M11 3.5l1.7 5L18 10l-5.3 1.5L11 16.5l-1.7-5L4 10l5.3-1.5z"/><path d="M19 15.5v4M17 17.5h4"/>"#),
    ("reset", r#"<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>"#),
    ("follow", r#"<path d="M5 4l14 6.2-6.2 2.3-2.3 6.2z"/>"#),
    ("idle", r#"<path d="M2 12c2.5-6 5-6 7.5 0s5 6 7.5 0c1.2-2.8 2.4-3.6 5-3"/>"#),
    ("reduced", r#"<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>"#),
    ("dock", r#"<path d="M7 15a5 5 0 1 1 10 0"/><path d="M3 15h18"/><path d="M9.5 15v3.5M14.5 15v3.5"/>"#),
    ("hide", r#"<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>"#),
    ("quit", r#"<path d="M12 3v8M6.5 6.6a8 8 0 1 0 11 0"/>"#),
    ("layers", r#"<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>"#),
    ("compare", r#"<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16M15 9h2M15 12h2"/>"#),
    ("upload", r#"<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>"#),
    ("play", r#"<path d="M7 4.5v15l12-7.5z"/>"#),
    ("chevron", r#"<path d="M6 9l6 6 6-6"/>"#),
    ("sun", r#"<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>"#),
    ("moon", r#"<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>"#),
    ("brand", r#"<path d="M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0"/>"#),
    ("chat", r#"<path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>"#),
    ("send", r#"<path d="M4 12l16-7-5.5 15-3-6.5z"/><path d="M11.5 13.5L20 5"/>"#),
    ("gear", r#"<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>"#),
];

pub fn icon(name: &str) -> Vec<Figure> {
    ICONS.iter().find(|i| i.0 == name).map(|i| parse_svg(i.1)).unwrap_or_default()
}

fn attr(el: &str, name: &str) -> Option<String> {
    let key = format!(" {name}=\"");
    let i = el.find(&key)? + key.len();
    let j = el[i..].find('"')? + i;
    Some(el[i..j].to_string())
}
fn num(el: &str, name: &str) -> f64 {
    attr(el, name).and_then(|v| v.parse().ok()).unwrap_or(0.0)
}

/// The elements of one icon body (`path`, `circle`, `rect`).
pub fn parse_svg(body: &str) -> Vec<Figure> {
    let mut out = Vec::new();
    for el in body.split('<').filter(|s| !s.trim().is_empty()) {
        let el = format!(" {}", el.trim_end_matches(['/', '>', ' ']));
        if el.starts_with(" path") {
            out.extend(parse_path(&attr(&el, "d").unwrap_or_default()));
        } else if el.starts_with(" circle") {
            let (cx, cy, r) = (num(&el, "cx"), num(&el, "cy"), num(&el, "r"));
            out.push(ellipse(cx, cy, r, r));
        } else if el.starts_with(" rect") {
            let (x, y, w, h, rx) = (num(&el, "x"), num(&el, "y"), num(&el, "width"), num(&el, "height"), num(&el, "rx"));
            out.push(round_rect(x, y, w, h, rx));
        }
    }
    out
}

const K: f64 = 0.552_284_749_830_793_4;
fn ellipse(cx: f64, cy: f64, rx: f64, ry: f64) -> Figure {
    let (kx, ky) = (rx * K, ry * K);
    Figure {
        start: (cx + rx, cy),
        segs: vec![
            Seg::Cubic([cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry]),
            Seg::Cubic([cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy]),
            Seg::Cubic([cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry]),
            Seg::Cubic([cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy]),
        ],
        closed: true,
    }
}
pub fn round_rect(x: f64, y: f64, w: f64, h: f64, r: f64) -> Figure {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    let k = r * (1.0 - K);
    Figure {
        start: (x + r, y),
        segs: vec![
            Seg::Line(x + w - r, y),
            Seg::Cubic([x + w - k, y, x + w, y + k, x + w, y + r]),
            Seg::Line(x + w, y + h - r),
            Seg::Cubic([x + w, y + h - k, x + w - k, y + h, x + w - r, y + h]),
            Seg::Line(x + r, y + h),
            Seg::Cubic([x + k, y + h, x, y + h - k, x, y + h - r]),
            Seg::Line(x, y + r),
            Seg::Cubic([x, y + k, x + k, y, x + r, y]),
        ],
        closed: true,
    }
}

/// Numbers of an SVG path, splitting "1.5-.2" and "1.5.2" the way browsers do.
fn tokens(d: &str) -> Vec<Result<char, f64>> {
    let mut out = Vec::new();
    let b: Vec<char> = d.chars().collect();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_alphabetic() && c != 'e' && c != 'E' {
            out.push(Ok(c));
            i += 1;
        } else if c.is_ascii_digit() || c == '-' || c == '+' || c == '.' {
            let start = i;
            i += 1;
            let mut dot = c == '.';
            while i < b.len() {
                let d = b[i];
                if d.is_ascii_digit() {
                    i += 1;
                } else if d == '.' && !dot {
                    dot = true;
                    i += 1;
                } else if (d == 'e' || d == 'E') && i + 1 < b.len() {
                    i += 1;
                    if b[i] == '-' || b[i] == '+' {
                        i += 1;
                    }
                } else {
                    break;
                }
            }
            let s: String = b[start..i].iter().collect();
            out.push(Err(s.parse().unwrap_or(0.0)));
        } else {
            i += 1;
        }
    }
    out
}

pub fn parse_path(d: &str) -> Vec<Figure> {
    let t = tokens(d);
    let mut figs: Vec<Figure> = Vec::new();
    let mut cur: Option<Figure> = None;
    let (mut x, mut y) = (0.0, 0.0);
    let (mut sx, mut sy) = (0.0, 0.0);
    let mut last_ctrl: Option<(f64, f64)> = None;
    let mut cmd = 'M';
    let mut i = 0;
    let nums = |i: &mut usize, n: usize| -> Option<Vec<f64>> {
        let mut v = Vec::with_capacity(n);
        while v.len() < n {
            match t.get(*i) {
                Some(Err(x)) => {
                    v.push(*x);
                    *i += 1;
                }
                _ => return None,
            }
        }
        Some(v)
    };
    loop {
        match t.get(i) {
            None => break,
            Some(Ok(c)) => {
                cmd = *c;
                i += 1;
                if cmd == 'z' || cmd == 'Z' {
                    if let Some(mut f) = cur.take() {
                        f.closed = true;
                        figs.push(f);
                    }
                    x = sx;
                    y = sy;
                    last_ctrl = None;
                    continue;
                }
            }
            Some(Err(_)) => {}
        }
        let rel = cmd.is_ascii_lowercase();
        let (ox, oy) = if rel { (x, y) } else { (0.0, 0.0) };
        let ensure = |cur: &mut Option<Figure>, x: f64, y: f64| {
            if cur.is_none() {
                *cur = Some(Figure { start: (x, y), ..Figure::default() });
            }
        };
        match cmd.to_ascii_uppercase() {
            'M' => {
                let Some(v) = nums(&mut i, 2) else { break };
                if let Some(f) = cur.take() {
                    figs.push(f);
                }
                x = ox + v[0];
                y = oy + v[1];
                sx = x;
                sy = y;
                cur = Some(Figure { start: (x, y), ..Figure::default() });
                cmd = if rel { 'l' } else { 'L' };
                last_ctrl = None;
            }
            'L' => {
                let Some(v) = nums(&mut i, 2) else { break };
                ensure(&mut cur, x, y);
                x = ox + v[0];
                y = oy + v[1];
                cur.as_mut().unwrap().segs.push(Seg::Line(x, y));
                last_ctrl = None;
            }
            'H' => {
                let Some(v) = nums(&mut i, 1) else { break };
                ensure(&mut cur, x, y);
                x = if rel { x + v[0] } else { v[0] };
                cur.as_mut().unwrap().segs.push(Seg::Line(x, y));
                last_ctrl = None;
            }
            'V' => {
                let Some(v) = nums(&mut i, 1) else { break };
                ensure(&mut cur, x, y);
                y = if rel { y + v[0] } else { v[0] };
                cur.as_mut().unwrap().segs.push(Seg::Line(x, y));
                last_ctrl = None;
            }
            'C' => {
                let Some(v) = nums(&mut i, 6) else { break };
                ensure(&mut cur, x, y);
                let c = [ox + v[0], oy + v[1], ox + v[2], oy + v[3], ox + v[4], oy + v[5]];
                cur.as_mut().unwrap().segs.push(Seg::Cubic(c));
                last_ctrl = Some((c[2], c[3]));
                x = c[4];
                y = c[5];
            }
            'S' => {
                let Some(v) = nums(&mut i, 4) else { break };
                ensure(&mut cur, x, y);
                let (c1x, c1y) = last_ctrl.map_or((x, y), |(cx, cy)| (2.0 * x - cx, 2.0 * y - cy));
                let c = [c1x, c1y, ox + v[0], oy + v[1], ox + v[2], oy + v[3]];
                cur.as_mut().unwrap().segs.push(Seg::Cubic(c));
                last_ctrl = Some((c[2], c[3]));
                x = c[4];
                y = c[5];
            }
            'Q' => {
                let Some(v) = nums(&mut i, 4) else { break };
                ensure(&mut cur, x, y);
                let (qx, qy, ex, ey) = (ox + v[0], oy + v[1], ox + v[2], oy + v[3]);
                cur.as_mut().unwrap().segs.push(Seg::Cubic([x + 2.0 / 3.0 * (qx - x), y + 2.0 / 3.0 * (qy - y), ex + 2.0 / 3.0 * (qx - ex), ey + 2.0 / 3.0 * (qy - ey), ex, ey]));
                last_ctrl = None;
                x = ex;
                y = ey;
            }
            'A' => {
                let Some(v) = nums(&mut i, 7) else { break };
                ensure(&mut cur, x, y);
                let (ex, ey) = (ox + v[5], oy + v[6]);
                for c in arc(x, y, v[0], v[1], v[2], v[3] != 0.0, v[4] != 0.0, ex, ey) {
                    cur.as_mut().unwrap().segs.push(Seg::Cubic(c));
                }
                last_ctrl = None;
                x = ex;
                y = ey;
            }
            _ => break,
        }
    }
    if let Some(f) = cur {
        figs.push(f);
    }
    figs
}

/// SVG endpoint arc to cubic Béziers (at most 90° each).
#[allow(clippy::too_many_arguments)]
fn arc(x1: f64, y1: f64, rx: f64, ry: f64, rot: f64, large: bool, sweep: bool, x2: f64, y2: f64) -> Vec<[f64; 6]> {
    if (x1 - x2).abs() < 1e-9 && (y1 - y2).abs() < 1e-9 {
        return Vec::new();
    }
    let (mut rx, mut ry) = (rx.abs(), ry.abs());
    if rx == 0.0 || ry == 0.0 {
        return vec![[x1, y1, x2, y2, x2, y2]];
    }
    let phi = rot.to_radians();
    let (cp, sp) = (phi.cos(), phi.sin());
    let (dx, dy) = ((x1 - x2) / 2.0, (y1 - y2) / 2.0);
    let (x1p, y1p) = (cp * dx + sp * dy, -sp * dx + cp * dy);
    let lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if lam > 1.0 {
        rx *= lam.sqrt();
        ry *= lam.sqrt();
    }
    let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let mut coef = (num / den).max(0.0).sqrt();
    if large == sweep {
        coef = -coef;
    }
    let (cxp, cyp) = (coef * rx * y1p / ry, -coef * ry * x1p / rx);
    let (cx, cy) = (cp * cxp - sp * cyp + (x1 + x2) / 2.0, sp * cxp + cp * cyp + (y1 + y2) / 2.0);
    let ang = |ux: f64, uy: f64, vx: f64, vy: f64| {
        let a = (ux * vy - uy * vx).atan2(ux * vx + uy * vy);
        a
    };
    let t1 = ang(1.0, 0.0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let mut dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if !sweep && dt > 0.0 {
        dt -= 2.0 * PI;
    } else if sweep && dt < 0.0 {
        dt += 2.0 * PI;
    }
    let n = (dt.abs() / (PI / 2.0)).ceil().max(1.0) as usize;
    let step = dt / n as f64;
    let k = 4.0 / 3.0 * (step / 4.0).tan();
    let point = |t: f64| {
        let (x, y) = (rx * t.cos(), ry * t.sin());
        (cp * x - sp * y + cx, sp * x + cp * y + cy)
    };
    let deriv = |t: f64| {
        let (x, y) = (-rx * t.sin(), ry * t.cos());
        (cp * x - sp * y, sp * x + cp * y)
    };
    (0..n)
        .map(|i| {
            let (a, b) = (t1 + step * i as f64, t1 + step * (i + 1) as f64);
            let (p0, p1) = (point(a), point(b));
            let (d0, d1) = (deriv(a), deriv(b));
            [p0.0 + k * d0.0, p0.1 + k * d0.1, p1.0 - k * d1.0, p1.1 - k * d1.1, p1.0, p1.1]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_icon_parses() {
        for (name, _) in ICONS {
            let f = icon(name);
            assert!(!f.is_empty(), "{name}");
            for fig in &f {
                for s in &fig.segs {
                    let pts: Vec<f64> = match s {
                        Seg::Line(x, y) => vec![*x, *y],
                        Seg::Cubic(c) => c.to_vec(),
                    };
                    assert!(pts.iter().all(|v| v.is_finite() && *v > -2.0 && *v < 26.0), "{name}: {pts:?}");
                }
            }
        }
    }
    #[test]
    fn path_details() {
        // "l3.5-.2": relative, packed numbers.
        let f = parse_path("M4.8 18.4L4 15l3.5-.2");
        assert_eq!(f[0].segs[1], Seg::Line(7.5, 14.8));
        // Implicit lineto after moveto, and h/v.
        let f = parse_path("M14 4h6v6");
        assert_eq!(f[0].segs, vec![Seg::Line(20.0, 4.0), Seg::Line(20.0, 10.0)]);
        // An arc ends where it says.
        let f = parse_path("M20 12a8 8 0 1 1-2.6-5.9");
        match f[0].segs.last().unwrap() {
            Seg::Cubic(c) => assert!((c[4] - 17.4).abs() < 1e-9 && (c[5] - 6.1).abs() < 1e-9),
            _ => panic!(),
        }
        assert!(parse_path("M11 3.5l1.7 5L18 10z")[0].closed);
    }
}
