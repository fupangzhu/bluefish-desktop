//! Replays the JS motion session recorded by `golden/motion.mjs` against the Rust port and
//! compares every recorded frame. Needs `node` on PATH; the recording is regenerated each run.
use bluefish::motion::attention::AttentionInput;
use bluefish::motion::peek::{Peek, PeekInput, PeekOut};
use bluefish::motion::touch::{Grip, Part, Point, TouchInput};
use bluefish::motion::tow::DipKind;
use bluefish::motion::{attention::AttentionState, Motion, Pose};
use bluefish::util::{Pt, Rand};
use serde_json::{Map, Value};
use std::path::PathBuf;

fn record() -> Value {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let out = root.join("target").join("golden");
    std::fs::create_dir_all(&out).unwrap();
    let file = out.join("motion.json");
    let status = std::process::Command::new("node")
        .arg(root.join("golden").join("motion.mjs"))
        .arg(&file)
        .status()
        .expect("node must be on PATH to record the JS golden run");
    assert!(status.success(), "golden recorder failed");
    serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap()
}

fn f(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(f64::NAN)
}
fn b(v: &Value, k: &str) -> bool {
    v.get(k).and_then(Value::as_bool).unwrap_or(false)
}
fn point(v: &Value) -> Point {
    Point::new(f(v, "x"), f(v, "y"), f(v, "sx"), f(v, "sy"))
}
fn part(v: &Value) -> Option<Part> {
    match v.as_str() {
        Some("ahoge") => Some(Part::Ahoge),
        Some("hair_front") => Some(Part::HairFront),
        Some("ear_l") => Some(Part::EarL),
        Some("ear_r") => Some(Part::EarR),
        Some("body") => Some(Part::Body),
        _ => None,
    }
}
fn grip(v: &Value) -> Option<Grip> {
    let s = v.get("source")?;
    Some(Grip { source: Pt::new(f(s, "x"), f(s, "y")), binding: None, outline: None, relative: false })
}

fn flat(c: &Pose, a: &AttentionState, p: &PeekOut, events: &str) -> Map<String, Value> {
    let mut o = Map::new();
    let mut n = |k: &str, v: f64| {
        o.insert(k.to_string(), Value::from(v));
    };
    let t = &c.touch;
    let bf = |v: bool| if v { 1.0 } else { 0.0 };
    for (k, v) in [
        ("sideEye", c.side_eye), ("shiftX", c.shift_x), ("shiftY", c.shift_y), ("yaw", c.yaw), ("pitch", c.pitch), ("roll", c.roll),
        ("gx", c.gx), ("gy", c.gy), ("left", c.left), ("right", c.right), ("hair", c.hair), ("ahogeWag", c.ahoge_wag),
        ("ahogeSide", c.ahoge_side), ("ahogeDroop", c.ahoge_droop), ("earMood", c.ear_mood), ("sleep", c.sleep),
        ("rubEyes", c.rub_eyes), ("rubHand", c.rub_hand), ("rubPhase", c.rub_phase), ("rubLift", c.rub_lift), ("rub", c.rub),
        ("relax", c.relax), ("time", c.time), ("breath", c.breath), ("slump", c.slump), ("slumpSide", c.slump_side),
        ("earPressL", c.ear_press_l), ("earPressR", c.ear_press_r), ("fringeX", t.fringe_x), ("fringeY", t.fringe_y),
        ("fringeFocus", t.fringe_focus), ("guard", t.guard), ("bonk", t.bonk), ("pain", t.pain), ("ahogePullX", t.ahoge_pull_x),
        ("ahogePullY", t.ahoge_pull_y), ("earFoldL", t.ear_fold_l), ("earFoldR", t.ear_fold_r), ("towing", t.towing),
        ("towLean", t.tow_lean), ("towWince", t.tow_wince), ("towSlip", t.tow_slip), ("dip", t.dip), ("dipMix", t.dip_mix),
        ("dipDir", t.dip_dir), ("dipKind", t.dip_kind), ("ahogeSway", t.ahoge_sway), ("reluctant", bf(c.reluctant)),
        ("sleeping", bf(c.sleeping)), ("movementBlocked", bf(c.movement_blocked)), ("secondary", bf(c.secondary)),
    ] {
        n(k, v);
    }
    if let Some(v) = c.ear_mood_l {
        n("earMoodL", v);
    }
    if let Some(v) = c.ear_sleep_l {
        n("earSleepL", v);
    }
    if let Some(e) = t.tow_end {
        n("towEnd.traveled", e.traveled);
        n("towEnd.slipped", bf(e.slipped));
        n("towEnd.dir", e.dir);
    }
    for (s, e) in [("L", t.ear_twitch_l), ("R", t.ear_twitch_r)] {
        if let Some(e) = e {
            n(&format!("earTwitch{s}.elapsed"), e.elapsed);
            n(&format!("earTwitch{s}.count"), e.count);
            n(&format!("earTwitch{s}.period"), e.period);
            n(&format!("earTwitch{s}.amplitude"), e.amplitude);
        }
    }
    if let Some(g) = t.ahoge_grab {
        n("grab.sourceX", g.source.x);
        n("grab.sourceY", g.source.y);
        n("grab.clientX", g.client.x);
        n("grab.clientY", g.client.y);
        n("grab.held", bf(g.held));
        n("grab.releasedAt", g.released_at);
        n("grab.strength", g.strength);
        n("grab.slip", bf(g.slip));
    }
    for (k, v) in [
        ("gazeWeight", a.gaze_weight), ("rub", a.rub), ("relax", a.relax), ("eyeCap", a.eye_cap), ("droop", a.droop), ("yaw", a.yaw),
        ("roll", a.roll), ("pitch", a.pitch), ("ahogeWag", a.ahoge_wag), ("sleep", a.sleep), ("sleepClosure", a.sleep_closure),
        ("wakeId", a.wake_id as f64), ("inactiveFor", a.inactive_for), ("sleeping", bf(a.sleeping)), ("woke", bf(a.woke)),
        ("attentive", bf(a.attentive)), ("rubbing", bf(a.rubbing)), ("resting", bf(a.resting)), ("interacting", bf(a.interacting)),
    ] {
        n(&format!("att.{k}"), v);
    }
    n("att.reluctant.active", bf(a.reluctant.active));
    n("att.reluctant.mix", a.reluctant.mix);
    n("att.reluctant.shiftX", a.reluctant.shift_x);
    n("peek.offsetX", p.offset_x);
    n("peek.roll", p.roll);
    n("peek.bob", p.bob);
    n("peek.held", bf(p.held));
    for (i, h) in p.hands.iter().enumerate() {
        for (k, v) in [("x", h.x), ("lift", h.lift), ("rot", h.rot), ("squash", h.squash), ("tap", h.tap), ("tapSquash", h.tap_squash), ("squeeze", h.squeeze)] {
            n(&format!("peek.hand{i}.{k}"), v);
        }
    }
    if let Some(ov) = p.over {
        for (k, v) in [("gx", ov.gx), ("gy", ov.gy), ("yaw", ov.yaw), ("roll", ov.roll), ("eyeCap", ov.eye_cap), ("droop", ov.droop)] {
            if let Some(v) = v {
                n(&format!("peek.override.{k}"), v);
            }
        }
    }
    let s = |v: Option<&str>| v.map_or(Value::Null, |s| Value::from(s));
    o.insert("wakePreset".into(), s(c.wake_preset.map(|p| p.name())));
    o.insert("rubReaction".into(), s(c.rub_reaction.map(|r| r.name())));
    o.insert("att.reaction".into(), s(a.reaction.map(|r| r.name())));
    o.insert("peek.mode".into(), Value::from(p.mode.name()));
    o.insert("peek.gesture".into(), s(p.gesture));
    o.insert("events".into(), Value::from(events));
    o
}

fn same(a: &Value, b: &Value) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => (x - y).abs() <= 1e-9 * (1.0 + x.abs().max(y.abs())),
        _ => a == b,
    }
}

#[test]
fn motion_matches_js() {
    let g = record();
    let ops = g["ops"].as_array().unwrap();
    let frames = g["frames"].as_array().unwrap();
    let mut motion = Motion::new(Rand::new(g["seed"].as_u64().unwrap() as u32));
    let mut peek = Peek::new(240.0, Rand::new(g["peekSeed"].as_u64().unwrap() as u32));
    let mut input = TouchInput::default();
    let mut events: Vec<String> = Vec::new();
    let (mut frame_index, mut next) = (0usize, 0usize);
    let mut worst = (0.0f64, String::new());
    let drain = |input: &mut TouchInput, events: &mut Vec<String>| {
        for on in input.drags.drain(..) {
            events.push(format!("drag:{}", on as u8));
        }
    };
    for op in ops {
        match op["op"].as_str().unwrap() {
            "begin" => {
                let gp = grip(&op["grip"]);
                input.begin(&mut motion.touch, part(&op["part"]), point(&op["point"]), f(op, "size"), gp.as_ref(), b(op, "head"), b(op, "tow"));
                if b(op, "tow") {
                    if let Some(l) = op.get("limits").and_then(Value::as_array) {
                        motion.touch.tow.set_limits(l[0].as_f64().unwrap(), l[1].as_f64().unwrap());
                    }
                }
                drain(&mut input, &mut events);
            }
            "move" => {
                input.move_to(&mut motion.touch, point(&op["point"]));
                drain(&mut input, &mut events);
            }
            "end" => {
                let bonked = input.end(&mut motion.touch, b(op, "cancel"));
                drain(&mut input, &mut events);
                if bonked {
                    events.push("bonk".into());
                }
            }
            "hover" => {
                let gp = grip(&op["grip"]);
                let p = op.get("point").filter(|p| !p.is_null()).map(point);
                input.hover(&mut motion.touch, part(&op["part"]), p, f(op, "size"), gp.as_ref());
            }
            "slumpPoke" => motion.slump.poke(),
            "blink" => motion.blink(),
            "gesture" => motion.gesture(op["name"].as_str().unwrap()),
            "twitch" => {
                motion.touch.twitch(if op["side"] == "l" { 0 } else { 1 }, false);
            }
            "dip" => motion.touch.dip.start(0.0, DipKind::Tow),
            "reset" => motion.reset(),
            "frame" => {
                let dt = f(op, "dt");
                let fresh = b(op, "fresh");
                let (follow, docked, reduced, idle) = (b(op, "follow"), b(op, "docked"), b(op, "reduced"), b(op, "idle"));
                let (poke, wake) = (b(op, "poke"), b(op, "wake"));
                let wall = op["wall"].as_array().unwrap();
                motion.follow = follow;
                motion.idle = idle;
                motion.reduced = reduced;
                motion.wall = (wall[0].as_f64().unwrap(), wall[1].as_f64().unwrap());
                if fresh {
                    motion.set_gaze(f(op, "gx"), f(op, "gy"));
                }
                let active = input.active.is_some();
                let ai = AttentionInput {
                    now: f(op, "now"),
                    reduced,
                    follow,
                    inner_side: f(op, "innerSide"),
                    x: if fresh { f(op, "x") } else { f64::NAN },
                    y: if fresh { f(op, "y") } else { f64::NAN },
                    size: 240.0,
                    near: b(op, "near"),
                    over_head: b(op, "overHead"),
                    hx: f(op, "hx"),
                    hy: f(op, "hy"),
                    blocked: active || motion.touch.bonking(),
                    wake,
                    poke: poke || active,
                };
                let attention = motion.attention.update(dt, &ai, &mut motion.wake);
                let hold = motion.blocks_travel();
                let out = peek.update(
                    dt,
                    &PeekInput {
                        gx: if fresh && follow && !active { f(op, "gx") * attention.gaze_weight } else { 0.0 },
                        gy: if fresh && follow { f(op, "gy") } else { 0.0 },
                        near: !attention.sleeping && (attention.attentive || !follow),
                        poke: !attention.sleeping && (poke || active),
                        docked,
                        reduced,
                        hold,
                    },
                );
                motion.over = if follow { out.over } else { None };
                if let Some(gname) = out.gesture {
                    if !attention.rubbing && !attention.sleeping && !attention.woke && !motion.wake.active() && !motion.touch.bonking() && !attention.reluctant.active {
                        motion.gesture(gname);
                    }
                }
                let cur = motion.step(dt);
                if cur.touch.tow_end.is_some_and(|e| e.traveled > 0.0) {
                    let r = motion.touch.dip.remaining();
                    motion.slump.arrive(r);
                }
                let joined = events.join(",");
                events.clear();
                if next < frames.len() && frames[next]["frame"].as_u64() == Some(frame_index as u64) {
                    let want = frames[next].as_object().unwrap();
                    let got = flat(&cur, &attention, &out, &joined);
                    for (k, v) in want {
                        if k == "frame" {
                            continue;
                        }
                        let g = got.get(k).unwrap_or_else(|| panic!("frame {frame_index}: Rust has no `{k}` (JS {v})"));
                        if let (Some(x), Some(y)) = (v.as_f64(), g.as_f64()) {
                            let d = (x - y).abs();
                            if d > worst.0 {
                                worst = (d, format!("frame {frame_index} {k}"));
                            }
                        }
                        assert!(same(v, g), "frame {frame_index}: `{k}` JS {v} vs Rust {g}");
                    }
                    for k in got.keys() {
                        assert!(want.contains_key(k), "frame {frame_index}: Rust has extra `{k}` = {}", got[k]);
                    }
                    next += 1;
                }
                frame_index += 1;
            }
            other => panic!("unknown op {other}"),
        }
    }
    assert_eq!(next, frames.len(), "every recorded frame was compared");
    println!("compared {} frames of {frame_index}; largest difference {:.3e} at {}", frames.len(), worst.0, worst.1);
}
