//! The editor previews (preview.mjs) on the Rust Motion must pose her exactly like the JS.
use bluefish::motion::attention::AttentionInput;
use bluefish::motion::preview::{Preview, PREVIEWS};
use bluefish::motion::{Motion, Pose};
use bluefish::util::Rand;
use serde_json::Value;
use std::path::PathBuf;

fn field(c: &Pose, k: &str) -> Option<f64> {
    let t = &c.touch;
    Some(match k {
        "yaw" => c.yaw,
        "pitch" => c.pitch,
        "roll" => c.roll,
        "gx" => c.gx,
        "gy" => c.gy,
        "left" => c.left,
        "right" => c.right,
        "hair" => c.hair,
        "ahogeWag" => c.ahoge_wag,
        "ahogeDroop" => c.ahoge_droop,
        "ahogeSide" => c.ahoge_side,
        "earMood" => c.ear_mood,
        "sleep" => c.sleep,
        "rubEyes" => c.rub_eyes,
        "rubLift" => c.rub_lift,
        "rubHand" => c.rub_hand,
        "dip" => t.dip,
        "dipMix" => t.dip_mix,
        "slump" => c.slump,
        "slumpSide" => c.slump_side,
        "breath" => c.breath,
        "guard" => t.guard,
        "pain" => t.pain,
        "fringeX" => t.fringe_x,
        "fringeY" => t.fringe_y,
        "towing" => t.towing,
        "shiftX" => c.shift_x,
        "shiftY" => c.shift_y,
        "earFoldL" => t.ear_fold_l,
        "earFoldR" => t.ear_fold_r,
        "towLean" => t.tow_lean,
        _ => return None,
    })
}

#[test]
fn previews_match_js() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let file = root.join("target").join("golden").join("preview.json");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    let ok = std::process::Command::new("node").arg(root.join("golden").join("preview.mjs")).arg(&file).status().unwrap();
    assert!(ok.success());
    let recs: Vec<Value> = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    let mut checked = 0;
    let mut total = 0;
    for &(name, _, d) in PREVIEWS.iter() {
        let mut m = Motion::new(Rand::new(3));
        m.attention.update(1.0 / 30.0, &AttentionInput { now: 0.0, ..AttentionInput::default() }, &mut m.wake);
        m.step(1.0 / 30.0);
        let mut p = Preview::default();
        p.select(&mut m, name).unwrap();
        let mut times: Vec<Option<f64>> = [0.0, 0.5, 1.0, d / 2.0, d].iter().map(|t| Some(*t)).collect();
        times.push(None);
        let mine: Vec<&Value> = recs.iter().filter(|r| r["name"] == name).collect();
        assert_eq!(mine.len(), times.len(), "{name}");
        for (j, t) in times.into_iter().enumerate() {
            match t {
                Some(t) => p.seek(&mut m, t),
                None => {
                    p.seek(&mut m, 0.0);
                    p.playing = true;
                    for _ in 0..30 {
                        p.step(&mut m, 1.0 / 60.0);
                    }
                }
            }
            let want = mine[j];
            let c = m.current;
            for (k, v) in want.as_object().unwrap() {
                let Some(w) = v.as_f64() else { continue };
                let got = match k.as_str() {
                    "shift" => p.stage_shift(&m),
                    "px" => p.pointer(&m).map_or(f64::NAN, |q| q.0),
                    "py" => p.pointer(&m).map_or(f64::NAN, |q| q.1),
                    "t" => continue,
                    k => field(&c, k).unwrap_or_else(|| panic!("no field {k}")),
                };
                assert!((w - got).abs() <= 1e-9 * (1.0 + w.abs()), "{name} @ {:?}: {k} js {w} rust {got}", t);
                checked += 1;
            }
            total += 1;
        }
    }
    assert_eq!(total, recs.len());
    println!("checked {checked} values over {total} preview poses");
}
