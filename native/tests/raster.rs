//! Pixels: the CPU rasterizer against pictures from the WebGL renderer (`golden/snapshot.cjs`, run
//! through Electron). Writes `target/golden/snap/<pose>.rust.png` and a diff image for each pose.
use bluefish::motion::Pose;
use bluefish::render::raster::{Frame, Target};
use bluefish::render::rig::{loader, Rig};
use bluefish::render::{Rect, Renderer};
use serde_json::Value;
use std::path::{Path, PathBuf};

fn n(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}
fn pose(j: &Value) -> Pose {
    let mut p = Pose::default();
    p.yaw = n(j, "yaw");
    p.pitch = n(j, "pitch");
    p.roll = n(j, "roll");
    p.hair = n(j, "hair");
    p.time = n(j, "time");
    p.left = n(j, "left");
    p.right = n(j, "right");
    p.gx = n(j, "gx");
    p.gy = n(j, "gy");
    p.sleep = n(j, "sleep");
    p.ear_mood = n(j, "earMood");
    p.ear_press_r = n(j, "earPressR");
    p.side_eye = n(j, "sideEye");
    p.ahoge_side = n(j, "ahogeSide");
    p.ahoge_wag = n(j, "ahogeWag");
    p.ahoge_droop = n(j, "ahogeDroop");
    p.breath = n(j, "breath");
    p.secondary = j["secondary"].as_bool().unwrap_or(false);
    p.touch.fringe_focus = n(j, "fringeFocus");
    p.touch.fringe_x = n(j, "fringeX");
    p.touch.pain = n(j, "pain");
    p
}
fn read_png(path: &Path) -> (usize, usize, Vec<u8>) {
    let img = bluefish::render::texture::Image::load_png(path).unwrap();
    (img.w, img.h, img.px)
}
fn write_png(path: &Path, w: usize, h: usize, rgba: &[u8]) {
    let f = std::fs::File::create(path).unwrap();
    let mut e = png::Encoder::new(std::io::BufWriter::new(f), w as u32, h as u32);
    e.set_color(png::ColorType::Rgba);
    e.set_depth(png::BitDepth::Eight);
    e.write_header().unwrap().write_image_data(rgba).unwrap();
}

#[test]
fn raster_matches_webgl() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let snap = root.join("target").join("golden").join("snap");
    if !snap.join("rest.png").exists() {
        eprintln!("no WebGL snapshots: run `node_modules/electron/dist/electron.exe native/golden/snapshot.cjs` first; skipping");
        return;
    }
    let assets = root.join("..").join("assets");
    let rig = Rig::load(&assets).unwrap();
    let t0 = std::time::Instant::now();
    let base = std::env::var("BF_BASE").ok().and_then(|v| v.parse().ok()).unwrap_or(1);
    let mut r = Renderer::new(&rig, loader(&assets, &rig, base));
    // BF_GPU=1 compares the Direct3D 11 path instead of the CPU rasterizer.
    #[cfg(windows)]
    let mut gpu = std::env::var_os("BF_GPU").map(|_| bluefish::render::gpu::Gpu::new(&r).expect("Direct3D 11"));
    println!("loaded in {:?}, textures {:.1} MB", t0.elapsed(), r.layers.iter().map(|l| l.tex.bytes()).sum::<usize>() as f64 / 1048576.0);
    r.padding = 0.35;
    let poses: Value = serde_json::from_slice(&std::fs::read(root.join("golden").join("poses.json")).unwrap()).unwrap();
    let size = 612usize;
    let mut frame = Frame::new(size, size);
    let rect = Rect { left: 0.0, top: 0.0, width: 408.0, height: 408.0 };
    for (name, pj) in poses.as_object().unwrap() {
        let s = pose(pj);
        frame.clear();
        let t = std::time::Instant::now();
        r.prepare(&s, rect);
        let prep = t.elapsed();
        let env = |k: &str| std::env::var(k).ok().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
        let target = Target { ox: env("BF_OX"), oy: env("BF_OY"), size: size as f64, clip: [0, 0, size as i32, size as i32] };
        #[cfg(windows)]
        if let Some(g) = gpu.as_mut() {
            g.draw(&r, &mut frame, &s, target).unwrap();
        } else {
            r.raster(&mut frame, &s, target);
        }
        #[cfg(not(windows))]
        r.raster(&mut frame, &s, target);
        let total = t.elapsed();
        let (w, h, refpx) = read_png(&snap.join(format!("{name}.png")));
        assert_eq!((w, h), (size, size));
        let mut ours = vec![0u8; size * size * 4];
        let mut diff = vec![0u8; size * size * 4];
        let (mut sum, mut big, mut covered) = (0u64, 0usize, 0usize);
        for i in 0..size * size {
            let p = frame.px[i];
            let (a, rr, g, b) = ((p >> 24) as u8, (p >> 16) as u8, (p >> 8) as u8, p as u8);
            // Compare premultiplied values; also save a straight-alpha copy to look at.
            let un = |c: u8| if a == 0 { 0 } else { ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8 };
            ours[i * 4..i * 4 + 4].copy_from_slice(&[un(rr), un(g), un(b), a]);
            let ra = refpx[i * 4 + 3] as u32;
            let pm = |c: u8| ((c as u32 * ra + 127) / 255) as i32;
            let want = [pm(refpx[i * 4]), pm(refpx[i * 4 + 1]), pm(refpx[i * 4 + 2]), ra as i32];
            let got = [rr as i32, g as i32, b as i32, a as i32];
            let mut m = 0;
            for k in 0..4 {
                let d = (want[k] - got[k]).abs();
                sum += d as u64;
                m = m.max(d);
            }
            if ra > 0 || a > 0 {
                covered += 1;
            }
            if m > 24 {
                big += 1;
            }
            let v = (m * 6).min(255) as u8;
            diff[i * 4..i * 4 + 4].copy_from_slice(&[v, v, v, 255]);
        }
        let tag = if std::env::var_os("BF_GPU").is_some() { "gpu" } else { "rust" };
        write_png(&snap.join(format!("{name}.{tag}.png")), size, size, &ours);
        write_png(&snap.join(format!("{name}.diff.png")), size, size, &diff);
        let mean = sum as f64 / (size * size * 4) as f64;
        let share = big as f64 / covered.max(1) as f64;
        println!("{name:8} prepare {prep:>9.2?} total {total:>9.2?}  mean |diff| {mean:.3}  pixels off by >24: {big} ({:.2}% of {covered})", share * 100.0);
        if std::env::var("BF_NOASSERT").is_ok() { continue; }
        assert!(mean < 0.3, "{name}: mean difference {mean}");
        assert!(share < 0.008, "{name}: {big} pixels differ a lot");
    }
}
