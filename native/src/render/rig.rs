//! assets/rig.json, and building each layer's texture from the layer PNGs.
use super::texture::{Image, Texture};
use crate::motion::ahoge::{COLOR_ROOT, COLOR_TOP, REST, REST_COUNT};
use crate::util::clamp;
use serde::Deserialize;
use std::path::Path;

#[derive(Clone, Debug, Deserialize)]
pub struct LayerMeta {
    pub name: String,
    #[serde(default)]
    pub file: String,
    #[serde(rename = "box")]
    pub bx: [f64; 4],
    pub pivot: [f64; 2],
    pub depth: f64,
    #[serde(default)]
    pub empty: bool,
    #[serde(rename = "eyeSide")]
    pub eye_side: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Eye {
    pub side: String,
    pub center: [f64; 2],
    #[serde(rename = "box")]
    pub bx: [f64; 4],
    pub tilt: f64,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Rig {
    pub size: [f64; 2],
    #[serde(rename = "drawOrder")]
    pub draw_order: Vec<String>,
    pub layers: Vec<LayerMeta>,
    pub eyes: Vec<Eye>,
}
impl Rig {
    pub fn load(assets: &Path) -> Result<Rig, String> {
        let text = std::fs::read(assets.join("rig.json")).map_err(|e| format!("rig.json: {e}"))?;
        serde_json::from_slice(&text).map_err(|e| format!("rig.json: {e}"))
    }
}

/// Reads every layer's pixels and returns a texture loader for `Renderer::new`.
/// `base_level`: how many times to halve the art before keeping it (1 = the 1024 grid, plenty
/// for the largest size at 200% scaling; the full 2048 grid is never kept in memory).
pub fn loader<'a>(assets: &Path, rig: &'a Rig, base_level: u32) -> impl FnMut(&str, [f64; 4]) -> Texture + use<'a> {
    let root = assets.parent().unwrap_or(assets).to_path_buf();
    move |name: &str, bx: [f64; 4]| {
        if name == "ahoge" {
            return Texture::from_image(ahoge_strip(), 0);
        }
        if let Some(side) = name.strip_prefix("eye_").and_then(|s| s.strip_suffix("_pain")) {
            let eye = rig.eyes.iter().find(|e| e.side == side).unwrap();
            return Texture::from_image(pain_lid(eye, bx), 0);
        }
        let meta = rig.layers.iter().find(|l| l.name == name).unwrap();
        let mut img = match Image::load_png(&root.join(&meta.file)) {
            Ok(full) => full.crop(meta.bx),
            Err(e) => {
                eprintln!("layer {name}: {e}");
                Image::empty((meta.bx[2] - meta.bx[0]) as usize, (meta.bx[3] - meta.bx[1]) as usize)
            }
        };
        if name == "hair_back" {
            clean_hair_backing(&mut img, meta.pivot[0] - meta.bx[0], meta.pivot[1] - meta.bx[1]);
        }
        if bx != meta.bx {
            img = img.pad((meta.bx[0] - bx[0]) as usize);
        }
        Texture::from_image(img, base_level)
    }
}

/// The separated backing includes isolated ear-tip/trim remnants. Keep its connected hair mass;
/// otherwise those pixels float in place when an ear folds.
pub fn clean_hair_backing(img: &mut Image, x: f64, y: f64) {
    let (w, h) = (img.w, img.h);
    let a = |img: &Image, i: usize| img.px[i * 4 + 3];
    let mut seen = vec![false; w * h];
    let mut queue: Vec<u32> = Vec::with_capacity(w * h / 2);
    let seed = clamp(y.floor(), 0.0, h as f64 - 1.0) as usize * w + clamp(x.floor(), 0.0, w as f64 - 1.0) as usize;
    if a(img, seed) == 0 {
        return;
    }
    queue.push(seed as u32);
    seen[seed] = true;
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head] as usize;
        head += 1;
        let col = i % w;
        let mut visit = |j: usize| {
            if !seen[j] && a(img, j) > 16 {
                seen[j] = true;
                queue.push(j as u32);
            }
        };
        if col > 0 {
            visit(i - 1);
        }
        if col < w - 1 {
            visit(i + 1);
        }
        if i >= w {
            visit(i - w);
        }
        if i < w * (h - 1) {
            visit(i + w);
        }
    }
    // Keep the antialiased fringe beside the main component; drop faint unrelated debris.
    for i in 0..w * h {
        if seen[i] {
            continue;
        }
        let (x, y) = ((i % w) as isize, (i / w) as isize);
        let mut neighbor = false;
        'n: for dy in -1..=1isize {
            for dx in -1..=1isize {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && nx < w as isize && ny >= 0 && ny < h as isize && seen[ny as usize * w + nx as usize] {
                    neighbor = true;
                    break 'n;
                }
            }
        }
        if !neighbor {
            img.px[i * 4 + 3] = 0;
        }
    }
}

/// The procedural ahoge strip: a vertical gradient, transparent first and last columns.
fn ahoge_strip() -> Image {
    let (w, h) = (64usize, 512usize);
    let mut img = Image::empty(w, h);
    for y in 0..h {
        let p = REST[(y as f64 / (h - 1) as f64 * (REST_COUNT - 1) as f64).round() as usize];
        let t = clamp((p.y - 140.0) / 365.0, 0.0, 1.0);
        for x in 0..w {
            let i = (y * w + x) * 4;
            for k in 0..3 {
                // Uint8ClampedArray rounds half to even.
                img.px[i + k] = (COLOR_TOP[k] + (COLOR_ROOT[k] - COLOR_TOP[k]) * t).round_ties_even() as u8;
            }
            img.px[i + 3] = if x == 0 || x == w - 1 { 0 } else { 255 };
        }
    }
    img
}

/// The reference's inward-facing > < eyelids, drawn in the closed frame's source coordinates.
fn pain_lid(eye: &Eye, bx: [f64; 4]) -> Image {
    use tiny_skia::{LineCap, LineJoin, Paint, PathBuilder, Pixmap, Stroke, Transform};
    let (w, h) = ((bx[2] - bx[0]) as u32, (bx[3] - bx[1]) as u32);
    let mut pm = Pixmap::new(w, h).unwrap();
    let dir: f32 = if eye.side == "l" { 1.0 } else { -1.0 };
    let mut pb = PathBuilder::new();
    pb.move_to(-dir * 60.0, -70.0);
    pb.line_to(dir * 62.0, 0.0);
    pb.line_to(-dir * 60.0, 70.0);
    let path = pb.finish().unwrap();
    let mut paint = Paint::default();
    paint.set_color_rgba8(0x23, 0x4c, 0x70, 255);
    paint.anti_alias = true;
    let stroke = Stroke { width: 27.0, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Stroke::default() };
    let t = Transform::from_translate((eye.center[0] - bx[0]) as f32, (eye.center[1] - bx[1]) as f32).pre_rotate(eye.tilt.to_degrees() as f32);
    pm.stroke_path(&path, &paint, &stroke, t, None);
    // tiny-skia stores premultiplied pixels; Image holds straight alpha.
    let mut img = Image::empty(w as usize, h as usize);
    for (i, p) in pm.pixels().iter().enumerate() {
        let c = p.demultiply();
        img.px[i * 4..i * 4 + 4].copy_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    img
}
