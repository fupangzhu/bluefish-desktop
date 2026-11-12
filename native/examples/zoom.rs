// Side-by-side 8x crop of two PNGs: cargo run --example zoom -- a.png b.png x y w h out.png
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let l = bluefish::render::texture::Image::load_png(std::path::Path::new(&a[1])).unwrap();
    let r = bluefish::render::texture::Image::load_png(std::path::Path::new(&a[2])).unwrap();
    let (x0, y0, w, h): (usize, usize, usize, usize) = (a[3].parse().unwrap(), a[4].parse().unwrap(), a[5].parse().unwrap(), a[6].parse().unwrap());
    let k = 8;
    let (ow, oh) = (w * k * 2 + 8, h * k);
    let mut out = vec![255u8; ow * oh * 4];
    for (side, img) in [&l, &r].into_iter().enumerate() {
        for y in 0..h * k {
            for x in 0..w * k {
                let s = ((y0 + y / k) * img.w + x0 + x / k) * 4;
                let a = img.px[s + 3] as u32;
                let d = (y * ow + side * (w * k + 8) + x) * 4;
                for c in 0..3 {
                    out[d + c] = ((img.px[s + c] as u32 * a + 255 * (255 - a)) / 255) as u8;
                }
            }
        }
    }
    let f = std::fs::File::create(&a[7]).unwrap();
    let mut e = png::Encoder::new(std::io::BufWriter::new(f), ow as u32, oh as u32);
    e.set_color(png::ColorType::Rgba);
    e.set_depth(png::BitDepth::Eight);
    e.write_header().unwrap().write_image_data(&out).unwrap();
}
