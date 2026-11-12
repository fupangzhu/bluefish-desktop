//! Layer pixels: straight-alpha images for loading, premultiplied mip chains for drawing.
use std::path::Path;

/// Straight (non-premultiplied) RGBA8.
pub struct Image {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}
impl Image {
    pub fn empty(w: usize, h: usize) -> Image {
        Image { w, h, px: vec![0; w * h * 4] }
    }
    pub fn load_png(path: &Path) -> Result<Image, String> {
        let file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let mut dec = png::Decoder::new(std::io::BufReader::new(file));
        dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16 | png::Transformations::ALPHA);
        let mut reader = dec.read_info().map_err(|e| e.to_string())?;
        let mut buf = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
        let (w, h) = (info.width as usize, info.height as usize);
        let px = match info.color_type {
            png::ColorType::Rgba => {
                buf.truncate(w * h * 4);
                buf
            }
            png::ColorType::GrayscaleAlpha => buf[..w * h * 2].chunks(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
            other => return Err(format!("{}: unexpected PNG color {other:?}", path.display())),
        };
        Ok(Image { w, h, px })
    }
    /// The pixels inside an art-space box (whole pixels; outside the image is transparent).
    pub fn crop(&self, bx: [f64; 4]) -> Image {
        let (x0, y0) = (bx[0] as isize, bx[1] as isize);
        let (w, h) = ((bx[2] - bx[0]) as usize, (bx[3] - bx[1]) as usize);
        let mut out = Image::empty(w, h);
        for y in 0..h {
            let sy = y0 + y as isize;
            if sy < 0 || sy >= self.h as isize {
                continue;
            }
            for x in 0..w {
                let sx = x0 + x as isize;
                if sx < 0 || sx >= self.w as isize {
                    continue;
                }
                let (s, d) = ((sy as usize * self.w + sx as usize) * 4, (y * w + x) * 4);
                out.px[d..d + 4].copy_from_slice(&self.px[s..s + 4]);
            }
        }
        out
    }
    /// A transparent border of `pad` pixels on every side.
    pub fn pad(&self, pad: usize) -> Image {
        let mut out = Image::empty(self.w + 2 * pad, self.h + 2 * pad);
        for y in 0..self.h {
            let (s, d) = (y * self.w * 4, ((y + pad) * out.w + pad) * 4);
            out.px[d..d + self.w * 4].copy_from_slice(&self.px[s..s + self.w * 4]);
        }
        out
    }
}

/// A level while building the chain: premultiplied RGBA bytes.
struct Level {
    w: usize,
    h: usize,
    px: Vec<[u8; 4]>,
}
impl Level {
    /// Next level down. Area-weighted, so an odd size never shifts the image (dropping the last
    /// column would move every texel of the level by up to half a texel).
    fn half(&self) -> Level {
        let (w, h) = ((self.w / 2).max(1), (self.h / 2).max(1));
        // Source span [a, b) of each destination texel, with the overlap weight of each source texel.
        let spans = |src: usize, dst: usize| -> Vec<Vec<(usize, f32)>> {
            let k = src as f64 / dst as f64;
            (0..dst)
                .map(|d| {
                    let (a, b) = (d as f64 * k, (d + 1) as f64 * k);
                    let mut out = Vec::with_capacity(3);
                    let mut s = a.floor() as usize;
                    while (s as f64) < b && s < src {
                        let wgt = (b.min(s as f64 + 1.0) - a.max(s as f64)) / k;
                        if wgt > 0.0 {
                            out.push((s, wgt as f32));
                        }
                        s += 1;
                    }
                    out
                })
                .collect()
        };
        let (sx, sy) = (spans(self.w, w), spans(self.h, h));
        // Horizontal pass into f32, then vertical.
        let mut tmp = vec![[0f32; 4]; w * self.h];
        for y in 0..self.h {
            for (x, span) in sx.iter().enumerate() {
                let mut acc = [0f32; 4];
                for &(s, wgt) in span {
                    let p = self.px[y * self.w + s];
                    for k in 0..4 {
                        acc[k] += p[k] as f32 * wgt;
                    }
                }
                tmp[y * w + x] = acc;
            }
        }
        let mut px = Vec::with_capacity(w * h);
        for span in &sy {
            for x in 0..w {
                let mut acc = [0f32; 4];
                for &(s, wgt) in span {
                    let p = tmp[s * w + x];
                    for k in 0..4 {
                        acc[k] += p[k] * wgt;
                    }
                }
                px.push(acc.map(|v| (v + 0.5).min(255.0) as u8));
            }
        }
        Level { w, h, px }
    }
}

/// One level of a layer's texture: premultiplied, packed like the frame (0xAARRGGBB).
pub struct Mip {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u32>,
}
impl Mip {
    fn pack(l: &Level) -> Mip {
        let px = l.px.iter().map(|p| (p[3] as u32) << 24 | (p[0] as u32) << 16 | (p[1] as u32) << 8 | p[2] as u32).collect();
        Mip { w: l.w, h: l.h, px }
    }
}

pub struct Texture {
    pub mips: Vec<Mip>,
    /// Alpha of `mips[0]`, for picking.
    alpha: Vec<u8>,
}
impl Texture {
    /// Premultiplies, halves `base_level` times, then builds the rest of the chain.
    pub fn from_image(img: Image, base_level: u32) -> Texture {
        let px = img
            .px
            .chunks_exact(4)
            .map(|c| {
                let a = c[3] as u32;
                let m = |v: u8| ((v as u32 * a + 127) / 255) as u8;
                [m(c[0]), m(c[1]), m(c[2]), c[3]]
            })
            .collect();
        let mut level = Level { w: img.w.max(1), h: img.h.max(1), px };
        if level.px.is_empty() {
            level.px = vec![[0; 4]];
        }
        for _ in 0..base_level {
            if level.w > 1 || level.h > 1 {
                level = level.half();
            }
        }
        let alpha = level.px.iter().map(|p| p[3]).collect();
        let mut mips = vec![Mip::pack(&level)];
        while (level.w > 1 || level.h > 1) && mips.len() < 12 {
            level = level.half();
            mips.push(Mip::pack(&level));
        }
        Texture { mips, alpha }
    }
    /// A fully opaque stand-in (tests that only check geometry).
    pub fn opaque(w: usize, h: usize) -> Texture {
        Texture { mips: vec![Mip { w, h, px: vec![u32::MAX; w * h] }], alpha: vec![255; w * h] }
    }
    pub fn width(&self) -> usize {
        self.mips[0].w
    }
    pub fn height(&self) -> usize {
        self.mips[0].h
    }
    /// The JS pick test: `alpha[floor(v*h)*w + floor(u*w)]`, clamped.
    pub fn alpha_at(&self, u: f64, v: f64) -> u8 {
        let (w, h) = (self.width(), self.height());
        let tx = ((u * w as f64).floor().max(0.0) as usize).min(w - 1);
        let ty = ((v * h as f64).floor().max(0.0) as usize).min(h - 1);
        self.alpha[ty * w + tx]
    }
    pub fn bytes(&self) -> usize {
        self.mips.iter().map(|m| m.px.len() * 4).sum::<usize>() + self.alpha.len()
    }
}
