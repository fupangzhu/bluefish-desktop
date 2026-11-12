//! hands.mjs: the two soft round hands resting across the taskbar edge, and the hands that cover
//! her head (bonk guard) or rub her eyes. Drawn with tiny-skia straight into the BGRA frame.
use crate::motion::peek::Hand;
use crate::motion::Pose;
use crate::render::raster::Frame;
use crate::render::Renderer;
use crate::util::{clamp, Pt};
use tiny_skia::{FillRule, Paint, PathBuilder, PixmapMut, Rect as SkRect, Stroke, Transform};

pub const HAND_WIDTH: f64 = 0.13;
pub const HAND_HEIGHT: f64 = 0.075;
pub const BELOW_LEDGE: f64 = 0.4;
pub const FALLBACK_SKIN: [f64; 3] = [253.0, 238.0, 232.0];
const SQUEEZE: f64 = 0.03;
const TAP_LIFT: f64 = 2.0;
const TAP_SQUASH: f64 = 0.1;

#[derive(Clone, Copy, Debug)]
pub struct Skin {
    pub base: [u8; 3],
    pub edge: [u8; 3],
}
pub fn make_skin(rgb: [f64; 3]) -> Skin {
    let base = rgb.map(|v| clamp(v.round(), 0.0, 255.0) as u8);
    let edge = [(base[0] as f64 * 0.955).round() as u8, (base[1] as f64 * 0.88).round() as u8, (base[2] as f64 * 0.87).round() as u8];
    Skin { base, edge }
}
/// The cheek colour: the average of the opaque face pixels around art (900, 1500).
pub fn sample_skin(r: &Renderer) -> Skin {
    let Some(face) = r.layer("face") else { return make_skin(FALLBACK_SKIN) };
    let m = &face.tex.mips[0];
    let (bw, bh) = (face.bx[2] - face.bx[0], face.bx[3] - face.bx[1]);
    let cx = ((900.0 - face.bx[0]) / bw * m.w as f64) as isize;
    let cy = ((1500.0 - face.bx[1]) / bh * m.h as f64) as isize;
    let rad = ((5.0 / bw * m.w as f64).round() as isize).max(1);
    let (mut acc, mut n) = ([0.0f64; 3], 0.0);
    for y in cy - rad..=cy + rad {
        for x in cx - rad..=cx + rad {
            if x < 0 || y < 0 || x >= m.w as isize || y >= m.h as isize {
                continue;
            }
            let p = m.px[y as usize * m.w + x as usize];
            let a = (p >> 24) as f64;
            if a > 200.0 {
                // Stored premultiplied.
                acc[0] += ((p >> 16) & 255) as f64 * 255.0 / a;
                acc[1] += ((p >> 8) & 255) as f64 * 255.0 / a;
                acc[2] += (p & 255) as f64 * 255.0 / a;
                n += 1.0;
            }
        }
    }
    if n < 5.0 {
        make_skin(FALLBACK_SKIN)
    } else {
        make_skin(acc.map(|v| v / n))
    }
}

struct Shape {
    wk: f64,
    hk: f64,
    tilt: f64,
    dy: f64,
}
fn shape(side: f64) -> Shape {
    if side < 0.0 {
        Shape { wk: 0.94, hk: 1.07, tilt: 0.0, dy: 0.6 }
    } else if side > 0.0 {
        Shape { wk: 1.04, hk: 0.95, tilt: -5f64.to_radians(), dy: -0.4 }
    } else {
        Shape { wk: 1.0, hk: 1.0, tilt: 0.0, dy: 0.0 }
    }
}

/// One hand to draw, in window CSS px.
#[derive(Clone, Copy, Debug, Default)]
pub struct HandDraw {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub lift: f64,
    pub squash: f64,
    pub side: f64,
    pub tap: f64,
    pub tap_squash: f64,
    pub squeeze: f64,
    pub contact: f64,
    pub centered: bool,
    pub alpha: f64,
}
impl HandDraw {
    /// The ellipse (centre transform, radii) that drawHand fills, in CSS px.
    fn geometry(&self) -> (Transform, f32, f32) {
        let u = self.w / HAND_WIDTH / 240.0;
        let sh = shape(self.side);
        let bw = self.w * sh.wk;
        let h0 = self.w * HAND_HEIGHT / HAND_WIDTH * sh.hk;
        let lift = self.lift + self.tap * TAP_LIFT * u;
        let squash = self.squash + self.tap_squash * TAP_SQUASH;
        let rise = clamp(lift / (h0 * 1.2), 0.0, 1.0);
        let sw = bw * (1.0 - 0.08 * rise);
        let shh = h0 * (1.0 + 0.28 * rise);
        let bottom = if self.centered { self.y + shh / 2.0 } else { self.y + sh.dy * u + h0 * BELOW_LEDGE - lift };
        let t = Transform::from_translate(self.x as f32, bottom as f32)
            .pre_scale(((1.0 + squash * 0.6) * (1.0 + SQUEEZE * self.squeeze)) as f32, ((1.0 - squash) * (1.0 - SQUEEZE * self.squeeze)) as f32)
            .pre_translate(0.0, (-shh / 2.0) as f32)
            .pre_rotate(sh.tilt.to_degrees() as f32);
        (t, (sw / 2.0) as f32, (shh / 2.0) as f32)
    }
    /// Is the CSS point on this hand (its filled ellipse)?
    pub fn hit(&self, x: f64, y: f64) -> bool {
        if self.alpha <= 0.1 {
            return false;
        }
        let (t, rx, ry) = self.geometry();
        let Some(inv) = t.invert() else { return false };
        let mut p = [tiny_skia::Point::from_xy(x as f32, y as f32)];
        inv.map_points(&mut p);
        let (u, v) = (p[0].x / rx, p[0].y / ry);
        u * u + v * v < 1.0
    }
}

/// Paints into the BGRA frame: tiny-skia writes RGBA, so the colours go in with red and blue swapped.
fn paint(c: [u8; 3], a: f64) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(c[2], c[1], c[0], (clamp(a, 0.0, 1.0) * 255.0).round() as u8);
    p.anti_alias = true;
    p
}
pub fn draw(frame: &mut Frame, hands: &[HandDraw], skin: &Skin, dpr: f64, clip_bottom: Option<f64>) {
    if hands.iter().all(|h| h.alpha <= 0.0) {
        return;
    }
    let bytes: &mut [u8] = bytemuck_u32(&mut frame.px);
    let Some(mut pm) = PixmapMut::from_bytes(bytes, frame.w as u32, frame.h as u32) else { return };
    let mask = clip_bottom.and_then(|b| {
        let mut m = tiny_skia::Mask::new(frame.w as u32, frame.h as u32)?;
        let r = SkRect::from_xywh(0.0, 0.0, frame.w as f32, (b * dpr) as f32)?;
        m.fill_path(&PathBuilder::from_rect(r), FillRule::Winding, false, Transform::identity());
        Some(m)
    });
    let scale = Transform::from_scale(dpr as f32, dpr as f32);
    for h in hands {
        if h.alpha <= 0.0 {
            continue;
        }
        let (t, rx, ry) = h.geometry();
        let Some(oval) = SkRect::from_xywh(-rx, -ry, 2.0 * rx, 2.0 * ry).and_then(PathBuilder::from_oval) else { continue };
        let t = scale.pre_concat(t);
        if h.contact > 0.0 {
            // A soft shadow below the hand: a few widening, fading ovals stand in for the blur.
            let blur = (h.w * 0.08) as f32;
            for k in 1..=4 {
                let g = blur * k as f32 / 4.0;
                if let Some(s) = SkRect::from_xywh(-rx - g, -ry - g, 2.0 * (rx + g), 2.0 * (ry + g)).and_then(PathBuilder::from_oval) {
                    let st = t.pre_translate(0.0, (h.w * 0.025) as f32);
                    pm.fill_path(&s, &paint(skin.edge, 0.25 * h.contact * h.alpha / 4.0), FillRule::Winding, st, mask.as_ref());
                }
            }
        }
        pm.fill_path(&oval, &paint(skin.base, h.alpha), FillRule::Winding, t, mask.as_ref());
        if h.contact > 0.0 {
            let stroke = Stroke { width: (h.w * 0.018).max(0.5) as f32, ..Stroke::default() };
            pm.stroke_path(&oval, &paint(skin.edge, 0.65 * h.contact * h.alpha), &stroke, t, mask.as_ref());
        }
    }
}
fn bytemuck_u32(px: &mut [u32]) -> &mut [u8] {
    // SAFETY: u32 has no padding and u8 has alignment 1; the length covers the same bytes.
    unsafe { std::slice::from_raw_parts_mut(px.as_mut_ptr() as *mut u8, px.len() * 4) }
}

/// The resting hands (drawHands): centred at `cx`, on the ledge.
pub fn resting(cx: f64, ledge_y: f64, s: f64, hands: &[Hand; 2], alpha: [f64; 2]) -> [HandDraw; 2] {
    let w = HAND_WIDTH * s;
    std::array::from_fn(|i| {
        let side = if i == 0 { -1.0 } else { 1.0 };
        let h = hands[i];
        HandDraw {
            x: cx + side * 0.21 * s + h.x,
            y: ledge_y,
            w,
            lift: h.lift,
            squash: h.squash,
            side,
            tap: h.tap,
            tap_squash: h.tap_squash,
            squeeze: h.squeeze,
            contact: 0.0,
            centered: false,
            alpha: alpha[i],
        }
    })
}

/// headGestureHands: hands that cover her head (bonk guard) or rub an eye, moving from their rest
/// spot toward the projected target. `rect`: the canvas rect in window CSS px.
pub fn head_gesture(r: &mut Renderer, pose: &Pose, rect: crate::render::Rect, sink: f64) -> Vec<(usize, HandDraw)> {
    let guard = pose.touch.guard;
    let rub = pose.rub_eyes;
    let amount = if guard != 0.0 { guard } else { rub };
    if amount <= 0.001 {
        return Vec::new();
    }
    let size = rect.width / (1.0 + 2.0 * r.padding);
    let (cx, cy) = (rect.left + rect.width / 2.0, rect.top + rect.height / 2.0);
    let eyes = r.eyes.clone();
    let mut out = Vec::new();
    for eye in &eyes {
        let side = if eye.side == "l" { -1.0 } else { 1.0 };
        let i = if side < 0.0 { 0 } else { 1 };
        if guard == 0.0 && i as f64 != pose.rub_hand {
            continue;
        }
        let name = if guard != 0.0 { "hair_front".to_string() } else { format!("eye_{}_open", eye.side) };
        let Some(&li) = r.by_name.get(&name) else { continue };
        let q = r.project(eye.center[0] + if guard != 0.0 { side * 200.0 } else { 0.0 }, eye.center[1] - if guard != 0.0 { 232.0 } else { 0.0 }, pose, li, false, None);
        let phase = pose.rub_phase + i as f64 * 0.5;
        let tx = cx + q.0 * size / 2.0 + if guard != 0.0 { 0.0 } else { phase.sin() * size * 0.006 };
        let ty = cy - q.1 * size / 2.0 + if guard != 0.0 { 0.0 } else { phase.cos() * size * 0.004 };
        let u = amount * amount * (3.0 - 2.0 * amount);
        let origin = Pt::new(cx + side * 0.21 * size, cy + 0.195 * size - sink);
        out.push((
            i,
            HandDraw {
                x: origin.x + (tx - origin.x) * u,
                y: origin.y + (ty - origin.y) * u,
                w: HAND_WIDTH * size,
                lift: size * 0.09 * amount,
                contact: amount * 0.7,
                alpha: clamp(amount / 0.22, 0.0, 1.0),
                centered: true,
                side,
                ..HandDraw::default()
            },
        ));
    }
    out
}
