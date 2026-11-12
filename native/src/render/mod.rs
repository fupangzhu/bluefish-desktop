//! renderer.mjs: the layered 2.5D rig. Geometry (projection, deformation, ahoge pull solving,
//! picking) lives here; pixels are filled by `raster`.
#[cfg(windows)]
pub mod gpu;
pub mod raster;
pub mod rig;
pub mod texture;

use crate::motion::ahoge::{
    ahoge_bounds, ahoge_geometry, ahoge_rest_angle, bind_ahoge, deform_ahoge, rebound_ahoge, solve_ahoge, AhogePose, Binding, Outline,
};
use crate::motion::small::{deform_ear, deform_fringe};
use crate::motion::{ear_input, Pose};
use crate::util::{clamp, rad, Pt};
use rig::{Eye, Rig};
use std::collections::HashMap;
use texture::Texture;

#[derive(Clone, Copy, Debug)]
pub struct Vertex {
    pub x: f64,
    pub y: f64,
    pub u: f64,
    pub v: f64,
    pub binding: Option<Binding>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Plain,
    Ahoge,
    HairFront,
    HairBack,
    EarL,
    EarR,
    BowL,
    BowR,
}
pub struct Layer {
    pub name: String,
    pub kind: Kind,
    pub bx: [f64; 4],
    pub pivot: [f64; 2],
    pub depth: f64,
    /// Some(true) for the left eye's layers, Some(false) for the right.
    pub eye_left: Option<bool>,
    pub procedural: bool,
    pub tex: Texture,
    pub points: Vec<Vertex>,
    /// Clip-space position and uv of each vertex, as the JS Float32Array.
    pub data: Vec<[f32; 4]>,
    pub bounds: [f64; 4],
    pub tris: Vec<TriInfo>,
    /// Per vertex: the (x, y) the bulge was last computed for, and the bulge.
    bulge: Vec<[f64; 3]>,
    /// The distinct vertices (a grid vertex is shared by up to six triangles), and which one each
    /// entry of `points` is: each distinct vertex is projected once per frame.
    pub uniq: Vec<Vertex>,
    pub index: Vec<u32>,
    /// Clip-space position of each distinct vertex this frame.
    pub proj: Vec<[f32; 2]>,
}
impl Layer {
    pub fn new(name: &str, bx: [f64; 4], pivot: [f64; 2], depth: f64, eye_left: Option<bool>, procedural: bool, tex: Texture) -> Layer {
        let kind = match name {
            "ahoge" => Kind::Ahoge,
            "hair_front" => Kind::HairFront,
            "hair_back" => Kind::HairBack,
            "ear_l" => Kind::EarL,
            "ear_r" => Kind::EarR,
            "bow_l" => Kind::BowL,
            "bow_r" => Kind::BowR,
            _ => Kind::Plain,
        };
        let points = if procedural {
            ahoge_geometry(256).into_iter().map(|p| Vertex { x: p.x, y: p.y, u: p.u, v: p.v, binding: Some(p.binding) }).collect()
        } else {
            let n = if name.starts_with("eye_") { 6 } else { 22 };
            let (w, h) = (bx[2] - bx[0], bx[3] - bx[1]);
            let mut pts = Vec::with_capacity(n * n * 6);
            let vertex = |i: usize, j: usize| {
                let (u, v) = (i as f64 / n as f64, j as f64 / n as f64);
                Vertex { x: bx[0] + w * u, y: bx[1] + h * v, u, v, binding: None }
            };
            for j in 0..n {
                for i in 0..n {
                    pts.extend_from_slice(&[vertex(i, j), vertex(i + 1, j), vertex(i, j + 1), vertex(i + 1, j), vertex(i + 1, j + 1), vertex(i, j + 1)]);
                }
            }
            pts
        };
        let data = points.iter().map(|p| [0.0, 0.0, p.u as f32, p.v as f32]).collect();
        let tris = triangle_info(&points, &tex);
        let mut seen: HashMap<[u64; 4], u32> = HashMap::new();
        let mut uniq = Vec::new();
        let index = points
            .iter()
            .map(|p| {
                *seen.entry([p.x.to_bits(), p.y.to_bits(), p.u.to_bits(), p.v.to_bits()]).or_insert_with(|| {
                    uniq.push(*p);
                    uniq.len() as u32 - 1
                })
            })
            .collect();
        let bulge = vec![[f64::NAN; 3]; uniq.len()];
        let proj = vec![[0.0; 2]; uniq.len()];
        Layer { name: name.to_string(), kind, bx, pivot, depth, eye_left, procedural, tex, points, data, bounds: [0.0; 4], tris, bulge, uniq, index, proj }
    }
}

/// For the rasterizer: which edges of each triangle are the mesh's outer edges (anti-aliased),
/// and whether the triangle's patch of texture has any opaque pixel at all.
#[derive(Clone, Copy, Debug)]
pub struct TriInfo {
    /// Edge k runs from vertex k+1 to k+2.
    pub boundary: [bool; 3],
    pub visible: bool,
}
fn triangle_info(points: &[Vertex], tex: &Texture) -> Vec<TriInfo> {
    let key = |p: &Vertex| (p.x.to_bits(), p.y.to_bits());
    let edge = |a: &Vertex, b: &Vertex| {
        let (ka, kb) = (key(a), key(b));
        if ka <= kb {
            (ka, kb)
        } else {
            (kb, ka)
        }
    };
    let mut count: HashMap<((u64, u64), (u64, u64)), u32> = HashMap::new();
    for t in points.chunks_exact(3) {
        for k in 0..3 {
            *count.entry(edge(&t[(k + 1) % 3], &t[(k + 2) % 3])).or_default() += 1;
        }
    }
    let m = &tex.mips[0];
    points
        .chunks_exact(3)
        .map(|t| {
            let boundary = std::array::from_fn(|k| count[&edge(&t[(k + 1) % 3], &t[(k + 2) % 3])] == 1);
            // Texels the triangle's uv box touches, plus a margin for filtering.
            let (u0, u1) = (t.iter().map(|p| p.u).fold(f64::INFINITY, f64::min), t.iter().map(|p| p.u).fold(f64::NEG_INFINITY, f64::max));
            let (v0, v1) = (t.iter().map(|p| p.v).fold(f64::INFINITY, f64::min), t.iter().map(|p| p.v).fold(f64::NEG_INFINITY, f64::max));
            let x0 = ((u0 * m.w as f64).floor() as isize - 3).max(0) as usize;
            let x1 = ((u1 * m.w as f64).ceil() as isize + 3).min(m.w as isize) as usize;
            let y0 = ((v0 * m.h as f64).floor() as isize - 3).max(0) as usize;
            let y1 = ((v1 * m.h as f64).ceil() as isize + 3).min(m.h as isize) as usize;
            let visible = (y0..y1).any(|y| m.px[y * m.w + x0..y * m.w + x1].iter().any(|p| p >> 24 != 0));
            TriInfo { boundary, visible }
        })
        .collect()
}

#[derive(Clone, Copy, Debug)]
pub struct Trig {
    yaw: f64,
    pitch: f64,
    roll: f64,
    cy: f64,
    sy: f64,
    cp: f64,
    sp: f64,
    cr: f64,
    sr: f64,
}
/// A layer queued for the rasterizer this frame.
#[derive(Clone, Copy, Debug)]
pub struct Draw {
    pub layer: usize,
    pub opacity: f64,
    pub eye_open: f64,
}
/// Where the canvas sits, in window CSS px (the JS `getBoundingClientRect()`).
#[derive(Clone, Copy, Debug, Default)]
pub struct Rect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Hit {
    pub part: &'static str,
    pub binding: Option<Binding>,
    pub source: Pt,
    pub outline: Option<Outline>,
}

pub struct Renderer {
    pub size: [f64; 2],
    pub eyes: Vec<Eye>,
    pub layers: Vec<Layer>,
    pub by_name: HashMap<String, usize>,
    draw_order: Vec<usize>,
    pub padding: f64,
    pub ahoge_pose: Option<AhogePose>,
    last_ahoge_pull: Option<(Pt, AhogePose)>,
    trig: Option<Trig>,
    pub queue: Vec<Draw>,
    /// Layers drawn with opacity > .1, in order (pick candidates).
    pub drawn: Vec<usize>,
    /// The editor's single-layer view.
    pub solo: Option<usize>,
}

impl Renderer {
    /// Builds the layers. `texture(name, box, procedural)` supplies each layer's pixels.
    pub fn new(rig: &Rig, mut texture: impl FnMut(&str, [f64; 4]) -> Texture) -> Renderer {
        let mut r = Renderer {
            size: rig.size,
            eyes: rig.eyes.clone(),
            layers: Vec::new(),
            by_name: HashMap::new(),
            draw_order: Vec::new(),
            padding: 0.0,
            ahoge_pose: None,
            last_ahoge_pull: None,
            trig: None,
            queue: Vec::new(),
            drawn: Vec::new(),
            solo: None,
        };
        for meta in &rig.layers {
            if meta.empty {
                continue;
            }
            // The half/closed eye frames are only shown in the editor's solo view.
            if meta.name.ends_with("_half") || meta.name.ends_with("_closed") {
                continue;
            }
            let eye_left = meta.eye_side.as_deref().map(|s| s == "l");
            if meta.name == "ahoge" {
                let bx = ahoge_bounds();
                let tex = texture("ahoge", bx);
                r.add(Layer::new("ahoge", bx, meta.pivot, meta.depth, eye_left, true, tex));
                continue;
            }
            let bx = if meta.name.ends_with("_open") && eye_left.is_some() {
                [meta.bx[0] - 64.0, meta.bx[1] - 64.0, meta.bx[2] + 64.0, meta.bx[3] + 64.0]
            } else {
                meta.bx
            };
            let tex = texture(&meta.name, bx);
            r.add(Layer::new(&meta.name, bx, meta.pivot, meta.depth, eye_left, false, tex));
        }
        // The > < eyelids use the closed frames' box, pivot and depth.
        for eye in &rig.eyes {
            let meta = rig.layers.iter().find(|l| l.name == format!("eye_{}_closed", eye.side)).expect("closed eye frame");
            let name = format!("eye_{}_pain", eye.side);
            let tex = texture(&name, meta.bx);
            r.add(Layer::new(&name, meta.bx, meta.pivot, meta.depth, Some(eye.side == "l"), false, tex));
        }
        let mut order: Vec<usize> = rig.draw_order.iter().filter(|n| *n != "ahoge").filter_map(|n| r.by_name.get(n).copied()).collect();
        if let Some(&a) = r.by_name.get("ahoge") {
            order.push(a);
        }
        r.draw_order = order;
        r
    }
    fn add(&mut self, layer: Layer) {
        self.by_name.insert(layer.name.clone(), self.layers.len());
        self.layers.push(layer);
    }
    pub fn layer(&self, name: &str) -> Option<&Layer> {
        self.by_name.get(name).map(|&i| &self.layers[i])
    }

    pub fn project(&mut self, px: f64, py: f64, s: &Pose, li: usize, raw: bool, binding: Option<&Binding>) -> (f64, f64) {
        let pose = self.ahoge_pose;
        project(&mut self.trig, self.size, &self.layers[li], pose.as_ref(), px, py, s, raw, binding)
    }

    fn draw(&mut self, li: usize, s: &Pose, opacity: f64, eye_open: f64) {
        if opacity <= 0.0 {
            return;
        }
        let v = 1.0 + 2.0 * self.padding;
        let pose = self.ahoge_pose;
        let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        let lf = layer_frame(&mut self.trig, &self.layers[li], s);
        let layer = &mut self.layers[li];
        let ear_kind = matches!(layer.kind, Kind::EarL | Kind::EarR);
        let ear = ear_kind.then(|| ear_input(s, layer.kind == Kind::EarL));
        let mut cache = std::mem::take(&mut layer.bulge);
        let mut out = std::mem::take(&mut layer.proj);
        out.clear();
        for (i, p) in layer.uniq.iter().enumerate() {
            let q = project_with(&lf, ear.as_ref(), self.size, layer, pose.as_ref(), p.x, p.y, s, false, p.binding.as_ref(), Some(&mut cache[i]));
            let (x, y) = (q.0 / v, q.1 / v);
            out.push([x as f32, y as f32]);
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        for (d, &k) in layer.data.iter_mut().zip(&layer.index) {
            let q = out[k as usize];
            d[0] = q[0];
            d[1] = q[1];
        }
        layer.bulge = cache;
        layer.proj = out;
        layer.bounds = [x0, y0, x1, y1];
        if opacity > 0.1 {
            self.drawn.push(li);
        }
        self.queue.push(Draw { layer: li, opacity, eye_open });
    }

    /// Lays out every layer for this pose (the JS `render()` minus the GL calls). `rect` is the
    /// canvas rect in window px, used to aim a pinched ahoge at the pointer.
    pub fn prepare(&mut self, s: &Pose, rect: Rect) {
        self.ahoge_pose = None;
        let grab = s.touch.ahoge_grab;
        if grab.is_none() {
            self.last_ahoge_pull = None;
        }
        let rebound = match (grab, self.last_ahoge_pull) {
            (Some(g), Some((src, pose))) if !g.held && src == g.source => Some(rebound_ahoge(&pose, g.strength)),
            _ => None,
        };
        if rebound.is_some() {
            self.ahoge_pose = rebound;
        } else if let Some(grab) = grab {
            let li = self.by_name["ahoge"];
            let aim = if grab.relative {
                let o = self.project(grab.source.x, grab.source.y, s, li, true, None);
                Pt::new(o.0 + grab.client.x / 120.0, o.1 - grab.client.y / 120.0)
            } else {
                let scale = 1.0 + 2.0 * self.padding;
                Pt::new(
                    ((grab.client.x - rect.left) / rect.width * 2.0 - 1.0) * scale,
                    (1.0 - (grab.client.y - rect.top) / rect.height * 2.0) * scale,
                )
            };
            // Invert the current head projection, so looking around never slides the pinched
            // material point out from under the cursor.
            let (mut x, mut y) = (grab.source.x, grab.source.y);
            for _ in 0..6 {
                let p = self.project(x, y, s, li, true, None);
                let dx = self.project(x + 1.0, y, s, li, true, None);
                let dy = self.project(x, y + 1.0, s, li, true, None);
                let (ax, ay, bx, by) = (dx.0 - p.0, dx.1 - p.1, dy.0 - p.0, dy.1 - p.1);
                let det = ax * by - ay * bx;
                if det.abs() < 1e-12 {
                    break;
                }
                let (ex, ey) = (aim.x - p.0, aim.y - p.1);
                x += clamp((ex * by - ey * bx) / det, -4096.0, 4096.0);
                y += clamp((ey * ax - ex * ay) / det, -4096.0, 4096.0);
            }
            let pose = solve_ahoge(grab.source, Pt::new(x, y), grab.strength, grab.base_outline.as_ref(), grab.binding.as_ref());
            self.ahoge_pose = Some(pose);
            if grab.held {
                self.last_ahoge_pull = Some((grab.source, pose));
            }
        }
        self.queue.clear();
        self.drawn.clear();
        if let Some(li) = self.solo {
            let l = &self.layers[li];
            let open = if l.name.ends_with("_open") { if l.eye_left == Some(true) { s.left } else { s.right } } else { -1.0 };
            self.draw(li, s, 1.0, open);
            return;
        }
        let order = self.draw_order.clone();
        for li in order {
            let layer = &self.layers[li];
            if layer.eye_left.is_some() && layer.name.ends_with("_open") {
                let openness = if layer.eye_left == Some(true) { s.left } else { s.right };
                let pain = if s.touch.pain > 0.08 { 1.0 } else { 0.0 };
                let pain_layer = self.by_name.get(&layer.name.replace("_open", "_pain")).copied();
                self.draw(li, s, 1.0 - pain, openness);
                if pain != 0.0 {
                    if let Some(p) = pain_layer {
                        self.draw(p, s, pain, -1.0);
                    }
                }
            } else {
                self.draw(li, s, 1.0, -1.0);
            }
        }
    }

    /// The part under a canvas-local point (CSS px), with the material point that was hit.
    /// `client` is the canvas size in CSS px.
    pub fn pick_hit(&self, x: f64, y: f64, client: f64) -> Option<Hit> {
        if x < 0.0 || y < 0.0 || x >= client || y >= client {
            return None;
        }
        let x = x / client * 2.0 - 1.0;
        let y = 1.0 - y / client * 2.0;
        for &li in self.drawn.iter().rev() {
            let layer = &self.layers[li];
            let [x0, y0, x1, y1] = layer.bounds;
            if x < x0 || x > x1 || y < y0 || y > y1 {
                continue;
            }
            let d = &layer.data;
            for t in (0..d.len()).step_by(3) {
                let (ax, ay, bx, by, cx, cy) =
                    (d[t][0] as f64, d[t][1] as f64, d[t + 1][0] as f64, d[t + 1][1] as f64, d[t + 2][0] as f64, d[t + 2][1] as f64);
                let den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
                if den.abs() < 1e-12 {
                    continue;
                }
                let a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
                let b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
                let c = 1.0 - a - b;
                if a < -0.00001 || b < -0.00001 || c < -0.00001 {
                    continue;
                }
                let u = a * d[t][2] as f64 + b * d[t + 1][2] as f64 + c * d[t + 2][2] as f64;
                let v = a * d[t][3] as f64 + b * d[t + 1][3] as f64 + c * d[t + 2][3] as f64;
                if layer.tex.alpha_at(u, v) <= 24 {
                    continue;
                }
                let part = match layer.kind {
                    Kind::Ahoge => "ahoge",
                    Kind::EarL => "ear_l",
                    Kind::EarR => "ear_r",
                    Kind::HairFront => "hair_front",
                    _ => return None,
                };
                let p = &layer.points[t..t + 3];
                if layer.procedural {
                    let mix = |f: fn(&Binding) -> f64| {
                        a * f(p[0].binding.as_ref().unwrap()) + b * f(p[1].binding.as_ref().unwrap()) + c * f(p[2].binding.as_ref().unwrap())
                    };
                    let binding = Binding { t: mix(|b| b.t), along: mix(|b| b.along), across: mix(|b| b.across), u: Some(mix(|b| b.u.unwrap())) };
                    let source = Pt::new(a * p[0].x + b * p[1].x + c * p[2].x, a * p[0].y + b * p[1].y + c * p[2].y);
                    return Some(Hit { part, binding: Some(binding), source, outline: self.ahoge_pose.map(|p| p.outline) });
                }
                let [x0, y0, x1, y1] = layer.bx;
                return Some(Hit { part, binding: None, source: Pt::new(x0 + u * (x1 - x0), y0 + v * (y1 - y0)), outline: None });
            }
        }
        None
    }
}

/// Everything `project()` computes once per layer per frame: identical values to the JS, which
/// recomputes them for every vertex.
#[derive(Clone, Copy)]
struct LayerFrame {
    lag: f64,
    t: f64,
    /// cos/sin of the layer's own rotation about its pivot, when it has one.
    rot: Option<(f64, f64)>,
    trig: Trig,
}
fn layer_frame(trig: &mut Option<Trig>, layer: &Layer, s: &Pose) -> LayerFrame {
    let lag = s.hair - s.yaw;
    let t = s.time;
    let (mut local_angle, mut droop) = (0.0, 0.0);
    match layer.kind {
        Kind::Ahoge => {
            local_angle = lag * 0.32 + if s.secondary { (t * 2.3).sin() * 1.2 } else { 0.0 } + s.ahoge_wag;
            droop = clamp(s.ahoge_droop, 0.0, 1.0);
        }
        Kind::BowL | Kind::BowR => {
            let phase = if layer.kind == Kind::BowL { 0.0 } else { 1.3 };
            local_angle = lag * 0.19 + if s.secondary { (t * 2.0 + phase).sin() * 0.8 } else { 0.0 };
        }
        Kind::EarL | Kind::EarR => local_angle = lag * 0.07 + if s.secondary { (t * 1.5).sin() * 0.22 } else { 0.0 },
        _ => {}
    }
    let rot = if local_angle != 0.0 || droop != 0.0 {
        let mut deg = local_angle;
        if droop != 0.0 {
            deg += ahoge_rest_angle(droop, s.ahoge_side);
        }
        let a = rad(deg);
        Some((a.cos(), a.sin()))
    } else {
        None
    };
    let k = match *trig {
        Some(k) if k.yaw == s.yaw && k.pitch == s.pitch && k.roll == s.roll => k,
        _ => {
            let (a, b, c) = (rad(s.yaw), rad(s.pitch), rad(s.roll));
            let k = Trig { yaw: s.yaw, pitch: s.pitch, roll: s.roll, cy: a.cos(), sy: a.sin(), cp: b.cos(), sp: b.sin(), cr: c.cos(), sr: c.sin() };
            *trig = Some(k);
            k
        }
    };
    LayerFrame { lag, t, rot, trig: k }
}

#[allow(clippy::too_many_arguments)]
fn project(
    trig: &mut Option<Trig>,
    size: [f64; 2],
    layer: &Layer,
    ahoge_pose: Option<&AhogePose>,
    px: f64,
    py: f64,
    s: &Pose,
    raw: bool,
    binding: Option<&Binding>,
) -> (f64, f64) {
    let lf = layer_frame(trig, layer, s);
    let ear = matches!(layer.kind, Kind::EarL | Kind::EarR).then(|| ear_input(s, layer.kind == Kind::EarL));
    project_with(&lf, ear.as_ref(), size, layer, ahoge_pose, px, py, s, raw, binding, None)
}

/// renderer.mjs `project()`. `bulge`: this vertex's cached (x, y, bulge), reused while x and y are
/// unchanged (the exp() is the dearest part and most layers never move in art space).
#[allow(clippy::too_many_arguments)]
#[inline]
fn project_with(
    lf: &LayerFrame,
    ear: Option<&crate::motion::small::EarInput>,
    size: [f64; 2],
    layer: &Layer,
    ahoge_pose: Option<&AhogePose>,
    mut px: f64,
    mut py: f64,
    s: &Pose,
    raw: bool,
    binding: Option<&Binding>,
    bulge: Option<&mut [f64; 3]>,
) -> (f64, f64) {
    let (w, h) = (size[0], size[1]);
    if layer.kind == Kind::Ahoge && !raw {
        if let Some(pose) = ahoge_pose {
            let b = binding.copied().unwrap_or_else(|| bind_ahoge(Pt::new(px, py)));
            let p = deform_ahoge(&b, Some(&pose.outline));
            px = p.x;
            py = p.y;
        }
    }
    if layer.kind == Kind::HairFront {
        (px, py) = deform_fringe(px, py, s.touch.fringe_x, s.touch.fringe_y, s.touch.fringe_focus);
    }
    if let Some(e) = ear {
        (px, py) = deform_ear(px, py, layer.kind == Kind::EarL, layer.pivot, layer.bx, e);
    }
    if let Some((c, sn)) = lf.rot {
        let (dx, dy) = (px - layer.pivot[0], py - layer.pivot[1]);
        px = layer.pivot[0] + c * dx - sn * dy;
        py = layer.pivot[1] + sn * dx + c * dy;
    }
    let (lag, t) = (lf.lag, lf.t);
    let mut x = px / w - 0.5;
    let y = py / h - 0.5;
    if layer.kind == Kind::HairBack {
        let tip = ((py / h - 0.48) / 0.5).max(0.0);
        x += lag * 0.0009 * tip + if s.secondary { (t * 1.6 + x * 4.0).sin() * 0.0025 * tip } else { 0.0 };
    }
    if layer.kind == Kind::HairFront {
        let tip = ((py / h - 0.42) / 0.5).max(0.0);
        x += lag * 0.0002 * tip;
    }
    let bulge = match bulge {
        Some(c) if c[0] == x && c[1] == y => c[2],
        Some(c) => {
            let b = 0.075 * (-((x / 0.38).powi(2) + ((y - 0.1) / 0.4).powi(2))).exp();
            *c = [x, y, b];
            b
        }
        None => 0.075 * (-((x / 0.38).powi(2) + ((y - 0.1) / 0.4).powi(2))).exp(),
    };
    let k = &lf.trig;
    let z = layer.depth + bulge;
    let xx = x * k.cy + z * k.sy;
    let zz = -x * k.sy + z * k.cy;
    let yy = y * k.cp - zz * k.sp;
    let rx = xx * k.cr - yy * k.sr;
    let ry = xx * k.sr + yy * k.cr;
    (rx * 1.76 + 2.0 * s.shift_x, -(ry + s.breath) * 1.76 - 2.0 * s.shift_y)
}
