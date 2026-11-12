//! Replays `golden/render.mjs`: the projected vertices of every drawn layer, the layer bounds and the
//! parts picked under a grid must match the JS renderer for every recorded pose.
use bluefish::motion::ahoge::Binding;
use bluefish::motion::small::EarTwitch;
use bluefish::motion::touch::Grab;
use bluefish::motion::Pose;
use bluefish::render::rig::Rig;
use bluefish::render::texture::Texture;
use bluefish::render::{Rect, Renderer};
use bluefish::util::Pt;
use serde_json::Value;
use std::path::PathBuf;

fn record() -> Value {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let out = root.join("target").join("golden");
    std::fs::create_dir_all(&out).unwrap();
    let file = out.join("render.json");
    let status = std::process::Command::new("node").arg(root.join("golden").join("render.mjs")).arg(&file).status().expect("node on PATH");
    assert!(status.success());
    serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap()
}
fn n(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}
fn pt(v: &Value) -> Pt {
    Pt::new(n(v, "x"), n(v, "y"))
}
fn pose(j: &Value) -> Pose {
    let mut p = Pose::default();
    p.yaw = n(j, "yaw");
    p.pitch = n(j, "pitch");
    p.roll = n(j, "roll");
    p.time = n(j, "time");
    p.hair = j.get("hair").and_then(Value::as_f64).unwrap_or(p.yaw);
    p.ahoge_wag = n(j, "ahogeWag");
    p.ahoge_droop = n(j, "ahogeDroop");
    p.ahoge_side = j.get("ahogeSide").and_then(Value::as_f64).unwrap_or(1.0);
    p.breath = n(j, "breath");
    p.shift_x = n(j, "shiftX");
    p.shift_y = n(j, "shiftY");
    p.sleep = n(j, "sleep");
    p.ear_mood = n(j, "earMood");
    p.ear_press_l = n(j, "earPressL");
    p.ear_press_r = n(j, "earPressR");
    p.side_eye = n(j, "sideEye");
    p.left = n(j, "left");
    p.right = n(j, "right");
    p.gx = n(j, "gx");
    p.gy = n(j, "gy");
    p.ear_mood_l = j.get("earMoodL").and_then(Value::as_f64);
    p.ear_sleep_l = j.get("earSleepL").and_then(Value::as_f64);
    p.secondary = j["secondary"].as_bool().unwrap();
    let t = &mut p.touch;
    t.fringe_x = n(j, "fringeX");
    t.fringe_y = n(j, "fringeY");
    t.fringe_focus = j.get("fringeFocus").and_then(Value::as_f64).unwrap_or(0.5);
    t.ear_fold_l = n(j, "earFoldL");
    t.ear_fold_r = n(j, "earFoldR");
    t.pain = n(j, "pain");
    let twitch = |v: Option<&Value>| v.map(|e| EarTwitch { elapsed: n(e, "elapsed"), count: n(e, "count"), period: n(e, "period"), amplitude: n(e, "amplitude") });
    t.ear_twitch_l = twitch(j.get("earTwitchL"));
    t.ear_twitch_r = twitch(j.get("earTwitchR"));
    if let Some(g) = j.get("ahogeGrab") {
        let binding = g.get("binding").filter(|b| !b.is_null()).map(|b| Binding {
            t: n(b, "t"),
            along: n(b, "along"),
            across: n(b, "across"),
            u: b.get("u").and_then(Value::as_f64),
        });
        let base_outline = g.get("baseOutline").filter(|o| !o.is_null()).map(|o| {
            std::array::from_fn(|e| std::array::from_fn(|i| pt(&o[e][i])))
        });
        t.ahoge_grab = Some(Grab {
            source: pt(&g["source"]),
            binding,
            base_outline,
            relative: g["relative"].as_bool().unwrap(),
            client: pt(&g["client"]),
            held: g["held"].as_bool().unwrap(),
            released_at: 0.0,
            strength: n(g, "strength"),
            slip: false,
        });
    }
    p
}

#[test]
fn geometry_matches_js() {
    let g = record();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("assets");
    let rig = Rig::load(&root).unwrap();
    let mut r = Renderer::new(&rig, |_, bx| Texture::opaque((bx[2] - bx[0]) as usize, (bx[3] - bx[1]) as usize));
    r.padding = g["pad"].as_f64().unwrap();
    let rc = &g["rect"];
    let rect = Rect { left: n(rc, "left"), top: n(rc, "top"), width: n(rc, "width"), height: n(rc, "height") };
    let (mut worst, mut checked, mut picks) = (0.0f64, 0usize, 0usize);
    for (fi, f) in g["frames"].as_array().unwrap().iter().enumerate() {
        let s = pose(&f["pose"]);
        r.prepare(&s, rect);
        let want = f["layers"].as_object().unwrap();
        let drawn: Vec<&str> = r.drawn.iter().map(|&i| r.layers[i].name.as_str()).collect();
        let mut names: Vec<&str> = want.keys().map(String::as_str).collect();
        names.sort();
        let mut have = drawn.clone();
        have.sort();
        assert_eq!(have, names, "frame {fi}: drawn layers");
        for (name, l) in want {
            let layer = r.layer(name).unwrap();
            assert_eq!(layer.data.len() as u64, l["n"].as_u64().unwrap(), "frame {fi} {name}: vertex count");
            let d = l["d"].as_array().unwrap();
            for (k, pair) in d.chunks(2).enumerate() {
                let v = layer.data[k * 7];
                for (c, want) in pair.iter().enumerate() {
                    let diff = (v[c] as f64 - want.as_f64().unwrap()).abs();
                    worst = worst.max(diff);
                    assert!(diff < 1e-5, "frame {fi} {name} vertex {} coord {c}: rust {} js {}", k * 7, v[c], want);
                    checked += 1;
                }
            }
            for (c, b) in l["bounds"].as_array().unwrap().iter().enumerate() {
                assert!((layer.bounds[c] - b.as_f64().unwrap()).abs() < 1e-6, "frame {fi} {name} bounds");
            }
        }
        let client = rect.width;
        let mut i = 0;
        let mut y = 0.0;
        while y < rect.height {
            let mut x = 0.0;
            while x < rect.width {
                let want = &f["picks"][i];
                let got = r.pick_hit(x, y, client);
                match (want.as_array(), got) {
                    (None, None) => {}
                    (Some(w), Some(h)) => {
                        assert_eq!(w[0].as_str().unwrap(), h.part, "frame {fi} pick ({x},{y})");
                        assert!((w[1].as_f64().unwrap() - h.source.x).abs() < 1e-3 && (w[2].as_f64().unwrap() - h.source.y).abs() < 1e-3, "frame {fi} pick source ({x},{y}): js {w:?} rust {:?}", h.source);
                        if let (Some(t), Some(b)) = (w[3].as_f64(), h.binding) {
                            assert!((t - b.t).abs() < 1e-3, "frame {fi} pick binding");
                        }
                        picks += 1;
                    }
                    (w, h) => panic!("frame {fi} pick ({x},{y}): js {w:?} rust {:?}", h.map(|h| h.part)),
                }
                i += 1;
                x += 9.0;
            }
            y += 9.0;
        }
    }
    println!("checked {checked} coordinates (worst {worst:.2e}) and {picks} picks");
}
