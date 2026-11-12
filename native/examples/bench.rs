// Steady-state cost of one frame while she idles: cargo run --release --example bench [size] [scale]
use bluefish::motion::attention::AttentionInput;
use bluefish::motion::Motion;
use bluefish::render::raster::{Frame, Target};
use bluefish::render::rig::{loader, Rig};
use bluefish::render::{Rect, Renderer};
use bluefish::util::Rand;
use std::time::{Duration, Instant};

fn main() {
    let args: Vec<f64> = std::env::args().skip(1).filter_map(|a| a.parse().ok()).collect();
    let s = args.first().copied().unwrap_or(240.0);
    let scale = args.get(1).copied().unwrap_or(1.5);
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("assets");
    let rig = Rig::load(&assets).unwrap();
    let mut r = Renderer::new(&rig, loader(&assets, &rig, 1));
    r.padding = 0.35;
    let css = s * 1.7;
    let px = (css * scale).round() as usize;
    let mut frame = Frame::new(px, px);
    let mut motion = Motion::new(Rand::new(1));
    motion.set_gaze(0.4, -0.2);
    let rect = Rect { left: 0.0, top: 0.0, width: css, height: css };
    let (mut prep, mut fill) = (Duration::ZERO, Duration::ZERO);
    let n = 300;
    for i in 0..n + 30 {
        let dt = 1.0 / 30.0;
        motion.attention.update(dt, &AttentionInput { now: i as f64 * dt, size: s, ..Default::default() }, &mut motion.wake);
        let pose = motion.step(dt);
        let t0 = Instant::now();
        r.prepare(&pose, rect);
        let t1 = Instant::now();
        frame.clear();
        r.raster(&mut frame, &pose, Target { ox: 0.0, oy: 0.0, size: px as f64, clip: [0, 0, px as i32, px as i32] });
        let t2 = Instant::now();
        if i >= 30 {
            prep += t1 - t0;
            fill += t2 - t1;
        }
    }
    let ms = |d: Duration| d.as_secs_f64() * 1000.0 / n as f64;
    println!("size {s} at {scale}x ({px}px): prepare {:.2} ms, fill {:.2} ms, total {:.2} ms per frame -> {:.1}% of a core at 30 fps",
        ms(prep), ms(fill), ms(prep) + ms(fill), (ms(prep) + ms(fill)) * 30.0 / 10.0);
}
