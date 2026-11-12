//! CPU rasterizer for the layer meshes: watertight fixed-point triangles (top-left rule, like a GPU)
//! with anti-aliased outer edges, integer trilinear sampling of premultiplied mip chains, the eye
//! fragment shader, and premultiplied "over" compositing done front to back, so pixels that are
//! already fully covered are never sampled.
use super::texture::{Mip, Texture};
use super::{Draw, Layer, Renderer};
use crate::motion::small::{eye_frame, eye_style};
use crate::motion::Pose;

/// Premultiplied 0xAARRGGBB (BGRA in memory), as `UpdateLayeredWindow` wants it.
pub struct Frame {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u32>,
}
impl Frame {
    pub fn new(w: usize, h: usize) -> Frame {
        Frame { w, h, px: vec![0; w * h] }
    }
    pub fn resize(&mut self, w: usize, h: usize) {
        if self.w != w || self.h != h {
            *self = Frame::new(w, h);
        }
    }
    pub fn clear(&mut self) {
        self.px.fill(0);
    }
    pub fn alpha(&self, x: usize, y: usize) -> u8 {
        if x >= self.w || y >= self.h {
            return 0;
        }
        (self.px[y * self.w + x] >> 24) as u8
    }
}

/// Clip space -> frame pixels: the canvas square of `size` px whose top-left is at (`ox`, `oy`),
/// drawn only inside `clip` (x0, y0, x1, y1 in frame px).
#[derive(Clone, Copy, Debug)]
pub struct Target {
    pub ox: f64,
    pub oy: f64,
    pub size: f64,
    pub clip: [i32; 4],
}

const SUB: f64 = 256.0;
/// Half-width (px) of the anti-aliased band on a mesh's outer edges.
const AA_HALF: f32 = 0.5;

// ---- packed-pixel helpers (two channels per 32-bit multiply) ---------------------------------
/// a + (b - a) * f / 256, per channel; f in 0..=256.
#[inline(always)]
fn lerp2(a: u32, b: u32, f: u32) -> u32 {
    let g = 256 - f;
    let rb = (((a & 0x00ff_00ff) * g + (b & 0x00ff_00ff) * f) >> 8) & 0x00ff_00ff;
    let ag = (((a >> 8) & 0x00ff_00ff) * g + ((b >> 8) & 0x00ff_00ff) * f) & 0xff00_ff00;
    rb | ag
}
/// c * k / 256 per channel; k in 0..=256.
#[inline(always)]
pub fn scale(c: u32, k: u32) -> u32 {
    ((((c & 0x00ff_00ff) * k) >> 8) & 0x00ff_00ff) | ((((c >> 8) & 0x00ff_00ff) * k) & 0xff00_ff00)
}
/// dst under-composited with src: dst + src * (1 - dst.a). Never overflows a channel.
#[inline(always)]
pub fn under(dst: u32, src: u32) -> u32 {
    let da = dst >> 24;
    // floor((255 - da) * 256 / 255), without a division.
    let k = if da == 0 { 256 } else { 255 - da };
    dst + scale(src, k)
}
#[inline(always)]
fn fetch(m: &Mip, x: i32, y: i32) -> u32 {
    let x = x.clamp(0, m.w as i32 - 1) as usize;
    let y = y.clamp(0, m.h as i32 - 1) as usize;
    // SAFETY: clamped to the level's size just above.
    unsafe { *m.px.get_unchecked(y * m.w + x) }
}
/// Bilinear at a 16.16 texel position (texel centres at integers).
#[inline(always)]
fn bilerp(m: &Mip, fx: i32, fy: i32) -> u32 {
    let (x0, y0) = (fx >> 16, fy >> 16);
    let (ax, ay) = (((fx >> 8) & 255) as u32, ((fy >> 8) & 255) as u32);
    let top = lerp2(fetch(m, x0, y0), fetch(m, x0 + 1, y0), ax);
    let bot = lerp2(fetch(m, x0, y0 + 1), fetch(m, x0 + 1, y0 + 1), ax);
    lerp2(top, bot, ay)
}
#[inline]
fn texel_fixed(m: &Mip, u: f64, v: f64) -> (i32, i32) {
    (((u * m.w as f64 - 0.5) * 65536.0) as i32, ((v * m.h as f64 - 0.5) * 65536.0) as i32)
}
/// The levels a triangle samples: one, or two blended by `mix` (0..=256 toward the second).
#[derive(Clone, Copy)]
struct Lod {
    l0: usize,
    l1: usize,
    mix: u32,
}
impl Lod {
    fn new(t: &Texture, lod: f32) -> Lod {
        let top = t.mips.len() - 1;
        let lod = lod.clamp(0.0, top as f32);
        let l0 = lod.floor() as usize;
        let f = lod - l0 as f32;
        // Close to a whole level, one bilinear lookup looks the same and costs half.
        if l0 >= top || f < 0.12 {
            Lod { l0, l1: l0, mix: 0 }
        } else if f > 0.88 {
            Lod { l0: l0 + 1, l1: l0 + 1, mix: 0 }
        } else {
            Lod { l0, l1: l0 + 1, mix: (f * 256.0) as u32 }
        }
    }
}
#[inline]
fn sample(t: &Texture, lod: Lod, u: f64, v: f64) -> u32 {
    let m0 = &t.mips[lod.l0];
    let (x, y) = texel_fixed(m0, u, v);
    let a = bilerp(m0, x, y);
    if lod.mix == 0 {
        return a;
    }
    let m1 = &t.mips[lod.l1];
    let (x, y) = texel_fixed(m1, u, v);
    lerp2(a, bilerp(m1, x, y), lod.mix)
}
#[inline]
fn unpack(p: u32) -> [f32; 4] {
    let k = 1.0 / 255.0;
    [((p >> 16) & 255) as f32 * k, ((p >> 8) & 255) as f32 * k, (p & 255) as f32 * k, (p >> 24) as f32 * k]
}
#[inline]
fn pack(c: [f32; 4]) -> u32 {
    let a = c[3].clamp(0.0, 1.0);
    let q = |v: f32| (v.clamp(0.0, a) * 255.0 + 0.5) as u32;
    (q(a) << 24) | (q(c[0]) << 16) | (q(c[1]) << 8) | q(c[2])
}
#[inline]
fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The eye fragment shader's uniforms (renderer.mjs `draw()`), all in art-normalized units.
#[derive(Clone, Copy)]
struct EyeUniforms {
    crop: [f32; 4],
    eye: [f32; 4],
    cs: f32,
    sn: f32,
    aa: f32,
    lid_shape: [f32; 4],
    lid_motion: [f32; 2],
    iris_gate: f32,
    iris_corner: f32,
    eye_gaze: [f32; 2],
    side_eye: f32,
    glance_shape: [f32; 2],
}
impl EyeUniforms {
    fn shade(&self, t: &Texture, lod: Lod, u: f32, v: f32) -> u32 {
        let c = &self.crop;
        let p = [c[0] + u * c[2] - self.eye[0], c[1] + v * c[3] - self.eye[1]];
        let (cs, sn) = (self.cs, self.sn);
        let xx = cs * p[0] + sn * p[1];
        let yy = -sn * p[0] + cs * p[1];
        let local = [xx - self.eye_gaze[0], yy - self.eye_gaze[1]];
        let source = [self.eye[0] + cs * local[0] - sn * local[1], self.eye[1] + sn * local[0] + cs * local[1]];
        let mut color = unpack(sample(t, lod, ((source[0] - c[0]) / c[2]) as f64, ((source[1] - c[1]) / c[3]) as f64));
        let r = self.lid_shape[0];
        let x = xx.clamp(-r, r);
        let arc = self.lid_shape[1] * (1.0 - x * x / (r * r));
        let profile = 1.0 - self.iris_corner * (xx * xx / (r * r)).min(1.0);
        let top = arc - self.lid_motion[0] * profile;
        let bottom = arc + self.lid_motion[1] * profile;
        let e = (self.aa * 0.5).max(0.0003);
        let corner = 1.0 - smoothstep(r - e, r + e, xx.abs());
        let mask = smoothstep(top - e, top + e, yy) * (1.0 - smoothstep(bottom - e, bottom + e, yy)) * self.iris_gate * (1.0 + (corner - 1.0) * self.iris_corner);
        for k in color.iter_mut() {
            *k *= mask;
        }
        if self.side_eye > 0.0 {
            let depth = self.glance_shape[1].max(0.00001);
            let ellipse = ((xx - self.eye_gaze[0]) / self.glance_shape[0]).hypot((yy - arc) / depth);
            let ellipse_aa = e / self.glance_shape[0].min(depth);
            let glance_alpha = (1.0 - smoothstep(1.0 - ellipse_aa, 1.0 + ellipse_aa, ellipse)) * smoothstep(top - e, top + e, yy) * self.iris_gate;
            let g = smoothstep(0.25, 1.0, (yy - arc) / depth);
            let blue = [0.18 * g, 0.61 + (0.77 - 0.61) * g, 0.89 + (0.96 - 0.89) * g];
            let glance = [blue[0] * glance_alpha, blue[1] * glance_alpha, blue[2] * glance_alpha, glance_alpha];
            for k in 0..4 {
                color[k] += (glance[k] - color[k]) * self.side_eye;
            }
        }
        let slope = -2.0 * x * (self.lid_shape[1] - self.lid_motion[0] * self.iris_corner) / (r * r);
        let distance = (xx - x).hypot((yy - top) / (1.0 + slope * slope).sqrt());
        let ink = (1.0 - smoothstep(self.lid_shape[2] - e, self.lid_shape[2] + e, distance)) * self.lid_shape[3];
        let lid = [0.10980392 * ink, 0.46666667 * ink, 0.75294118 * ink, ink];
        for k in 0..4 {
            color[k] = lid[k] + color[k] * (1.0 - ink);
        }
        pack(color)
    }
}

impl Renderer {
    fn eye_uniforms(&self, layer: &Layer, d: &Draw, s: &Pose, canvas_px: f64) -> Option<EyeUniforms> {
        if d.eye_open < 0.0 {
            return None;
        }
        let left = layer.eye_left?;
        let (w, h) = (self.size[0], self.size[1]);
        let e = self.eyes.iter().find(|e| (e.side == "l") == left)?;
        let f = eye_frame(d.eye_open.max(0.0), s.side_eye);
        let half = (e.bx[3] - e.bx[1]) / h * 0.47;
        let [x0, y0, x1, y1] = layer.bx;
        Some(EyeUniforms {
            crop: [(x0 / w) as f32, (y0 / h) as f32, ((x1 - x0) / w) as f32, ((y1 - y0) / h) as f32],
            eye: [(e.center[0] / w) as f32, (e.center[1] / h) as f32, e.tilt as f32, half as f32],
            cs: (e.tilt as f32).cos(),
            sn: (e.tilt as f32).sin(),
            aa: (1.5 / (canvas_px / (1.0 + 2.0 * self.padding) * 0.88)) as f32,
            lid_shape: [(f.radius / w) as f32, (f.curve / h) as f32, (eye_style::STROKE / h / 2.0) as f32, f.line as f32],
            lid_motion: [(f.upper * half) as f32, (f.lower * half) as f32],
            iris_gate: f.iris as f32,
            iris_corner: f.corner as f32,
            eye_gaze: [(s.gx * f.gaze_span) as f32, (s.gy * 0.006) as f32],
            side_eye: f.side_eye as f32,
            glance_shape: [(eye_style::GLANCE_RADIUS / w) as f32, (half * eye_style::GLANCE_DEPTH * (d.eye_open / 0.5).clamp(0.0, 1.0)) as f32],
        })
    }

    /// Composites this pose (after `prepare`) under whatever the frame already holds, front layer
    /// first. Clear the frame first for a fresh picture.
    pub fn raster(&self, frame: &mut Frame, s: &Pose, target: Target) {
        for d in self.queue.iter().rev() {
            let layer = &self.layers[d.layer];
            let eye = self.eye_uniforms(layer, d, s, target.size);
            draw_layer(frame, layer, d.opacity as f32, eye.as_ref(), &target);
        }
    }
}

fn draw_layer(frame: &mut Frame, layer: &Layer, opacity: f32, eye: Option<&EyeUniforms>, t: &Target) {
    let tex = &layer.tex;
    let (tw, th) = (tex.width() as f64, tex.height() as f64);
    let clip = [t.clip[0].max(0), t.clip[1].max(0), t.clip[2].min(frame.w as i32), t.clip[3].min(frame.h as i32)];
    if clip[0] >= clip[2] || clip[1] >= clip[3] {
        return;
    }
    let to_px = |x: f64, y: f64| (t.ox + (x + 1.0) * 0.5 * t.size, t.oy + (1.0 - y) * 0.5 * t.size);
    let (bx0, by1) = to_px(layer.bounds[0], layer.bounds[1]);
    let (bx1, by0) = to_px(layer.bounds[2], layer.bounds[3]);
    if bx1 < clip[0] as f64 || bx0 > clip[2] as f64 || by1 < clip[1] as f64 || by0 > clip[3] as f64 {
        return;
    }
    // Every distinct vertex to frame pixels (1/256 px), once per layer.
    let scr: Vec<[i64; 2]> = layer
        .proj
        .iter()
        .map(|q| {
            let (x, y) = to_px(q[0] as f64, q[1] as f64);
            [(x * SUB).round() as i64, (y * SUB).round() as i64]
        })
        .collect();
    let sub = SUB as i64;
    let (cx0, cy0, cx1, cy1) = (clip[0] as i64 * sub, clip[1] as i64 * sub, clip[2] as i64 * sub, clip[3] as i64 * sub);
    let fw = frame.w;
    for (ti, idx) in layer.index.chunks_exact(3).enumerate() {
        let info = layer.tris[ti];
        // Fully transparent patch of texture (and no shader that draws outside it).
        if !info.visible && eye.is_none() {
            continue;
        }
        let mut p = [scr[idx[0] as usize], scr[idx[1] as usize], scr[idx[2] as usize]];
        let (lo_x, hi_x) = (p[0][0].min(p[1][0]).min(p[2][0]), p[0][0].max(p[1][0]).max(p[2][0]));
        let (lo_y, hi_y) = (p[0][1].min(p[1][1]).min(p[2][1]), p[0][1].max(p[1][1]).max(p[2][1]));
        if hi_x + sub < cx0 || lo_x - sub > cx1 || hi_y + sub < cy0 || lo_y - sub > cy1 {
            continue;
        }
        let d3 = &layer.data[ti * 3..ti * 3 + 3];
        let mut v = [[0f64; 4]; 3];
        for k in 0..3 {
            v[k] = [0.0, 0.0, d3[k][2] as f64, d3[k][3] as f64];
        }
        let mut area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
        if area == 0 {
            continue;
        }
        let mut boundary = info.boundary;
        if area < 0 {
            p.swap(1, 2);
            v.swap(1, 2);
            boundary.swap(1, 2);
            area = -area;
        }
        let any_aa = boundary[0] | boundary[1] | boundary[2];
        let grow = if any_aa { 1 } else { 0 };
        let minx = ((lo_x >> 8) as i32 - grow).max(clip[0]);
        let maxx = (((hi_x + sub - 1) >> 8) as i32 + grow).min(clip[2] - 1);
        let miny = ((lo_y >> 8) as i32 - grow).max(clip[1]);
        let maxy = (((hi_y + sub - 1) >> 8) as i32 + grow).min(clip[3] - 1);
        if minx > maxx || miny > maxy {
            continue;
        }
        // Edge k runs from vertex k+1 to k+2; its function weighs vertex k. Inner edges use the
        // top-left rule (shared edges are filled exactly once); outer edges get a coverage band.
        let mut a = [0i64; 3];
        let mut b = [0i64; 3];
        let mut lim = [0i64; 3];
        let mut to_dist = [0f32; 3];
        for k in 0..3 {
            let (s, e) = (p[(k + 1) % 3], p[(k + 2) % 3]);
            let (dx, dy) = (e[0] - s[0], e[1] - s[1]);
            a[k] = -dy;
            b[k] = dx;
            lim[k] = if boundary[k] {
                let len = ((dx * dx + dy * dy) as f64).sqrt();
                to_dist[k] = (1.0 / (len * SUB)) as f32;
                -((AA_HALF as f64) * len * SUB) as i64
            } else if (dy == 0 && dx > 0) || dy < 0 {
                0
            } else {
                1
            };
        }
        let cx = minx as i64 * sub + sub / 2;
        let cy = miny as i64 * sub + sub / 2;
        let mut row = [0i64; 3];
        for k in 0..3 {
            let s = p[(k + 1) % 3];
            row[k] = a[k] * (cx - s[0]) + b[k] * (cy - s[1]);
        }
        let inv = 1.0 / area as f64;
        let grad = |c: usize| {
            let (q0, q1, q2) = (v[0][c], v[1][c], v[2][c]);
            let dx = (q0 * a[0] as f64 + q1 * a[1] as f64 + q2 * a[2] as f64) * inv * SUB;
            let dy = (q0 * b[0] as f64 + q1 * b[1] as f64 + q2 * b[2] as f64) * inv * SUB;
            (dx, dy)
        };
        let (dudx, dudy) = grad(2);
        let (dvdx, dvdy) = grad(3);
        let (ax, ay, bx2, by2) = (dudx * tw, dvdx * th, dudy * tw, dvdy * th);
        let rho2 = (ax * ax + ay * ay).max(bx2 * bx2 + by2 * by2);
        let lod = Lod::new(tex, if rho2 > 1.0 { 0.5 * (rho2 as f32).log2() } else { 0.0 });
        let w0 = [row[0] as f64 * inv, row[1] as f64 * inv, row[2] as f64 * inv];
        let u00 = w0[0] * v[0][2] + w0[1] * v[1][2] + w0[2] * v[2][2];
        let v00 = w0[0] * v[0][3] + w0[1] * v[1][3] + w0[2] * v[2][3];
        // Fixed-point texel position at the box's first pixel centre, and its steps per pixel
        // across (s) and per row down (r), for each sampled level. All integer from here on.
        let (m0, m1) = (&tex.mips[lod.l0], &tex.mips[lod.l1]);
        let steps = |m: &Mip| {
            let (w, h) = (m.w as f64 * 65536.0, m.h as f64 * 65536.0);
            ((dudx * w) as i32, (dvdx * h) as i32, (dudy * w) as i32, (dvdy * h) as i32)
        };
        let (s0, s1) = (steps(m0), steps(m1));
        let (mut r0x, mut r0y) = texel_fixed(m0, u00, v00);
        let (mut r1x, mut r1y) = texel_fixed(m1, u00, v00);
        let (mut ru, mut rv) = (u00 as f32, v00 as f32);
        let (fdudx, fdvdx, fdudy, fdvdy) = (dudx as f32, dvdx as f32, dudy as f32, dvdy as f32);
        let base_k = (opacity * 256.0) as u32;
        let stepx = [a[0] * sub, a[1] * sub, a[2] * sub];
        let inv_step = [1.0 / stepx[0] as f64, 1.0 / stepx[1] as f64, 1.0 / stepx[2] as f64];
        for y in miny..=maxy {
            // The pixels of this row inside all three edges: estimated with a multiply, then made
            // exact against the integer edge functions (no division per row).
            let (mut xs, mut xe) = (0i64, (maxx - minx) as i64);
            for k in 0..3 {
                let (w0, st, l) = (row[k], stepx[k], lim[k]);
                if st > 0 {
                    if w0 < l {
                        let mut x = ((l - w0) as f64 * inv_step[k]).ceil() as i64;
                        while w0 + st * x < l {
                            x += 1;
                        }
                        while x > 0 && w0 + st * (x - 1) >= l {
                            x -= 1;
                        }
                        xs = xs.max(x);
                    }
                } else if st < 0 {
                    if w0 < l {
                        xe = -1;
                    } else {
                        let mut x = ((w0 - l) as f64 * -inv_step[k]).floor() as i64;
                        while w0 + st * (x + 1) >= l {
                            x += 1;
                        }
                        while x >= 0 && w0 + st * x < l {
                            x -= 1;
                        }
                        xe = xe.min(x);
                    }
                } else if w0 < l {
                    xe = -1;
                }
            }
            if xs <= xe {
                let skip = xs;
                let (xs, xe) = (xs + minx as i64, xe + minx as i64);
                let mut w = [row[0] + stepx[0] * skip, row[1] + stepx[1] * skip, row[2] + stepx[2] * skip];
                let sk = skip as i32;
                let (mut t0x, mut t0y) = (r0x + s0.0 * sk, r0y + s0.1 * sk);
                let (mut t1x, mut t1y) = (r1x + s1.0 * sk, r1y + s1.1 * sk);
                let (mut uf, mut vf) = (ru + fdudx * skip as f32, rv + fdvdx * skip as f32);
                let line = y as usize * fw;
                for x in xs as i32..=xe as i32 {
                    // SAFETY: x, y are clipped to the frame above.
                    let d = unsafe { frame.px.get_unchecked_mut(line + x as usize) };
                    if *d < 0xff00_0000 {
                        let mut k = base_k;
                        if any_aa {
                            let mut cover = 1.0f32;
                            for e in 0..3 {
                                if boundary[e] {
                                    cover *= (AA_HALF + w[e] as f32 * to_dist[e]).min(1.0);
                                }
                            }
                            k = (cover * opacity * 256.0) as u32;
                        }
                        let mut c = match eye {
                            Some(e) => e.shade(tex, lod, uf, vf),
                            None => {
                                let a = bilerp(m0, t0x, t0y);
                                if lod.mix == 0 {
                                    a
                                } else {
                                    lerp2(a, bilerp(m1, t1x, t1y), lod.mix)
                                }
                            }
                        };
                        if k < 256 {
                            c = scale(c, k);
                        }
                        if c != 0 {
                            *d = under(*d, c);
                        }
                    }
                    for e in 0..3 {
                        w[e] += stepx[e];
                    }
                    t0x += s0.0;
                    t0y += s0.1;
                    t1x += s1.0;
                    t1y += s1.1;
                    uf += fdudx;
                    vf += fdvdx;
                }
            }
            for e in 0..3 {
                row[e] += b[e] * sub;
            }
            r0x += s0.2;
            r0y += s0.3;
            r1x += s1.2;
            r1y += s1.3;
            ru += fdudy;
            rv += fdvdy;
        }
    }
}
