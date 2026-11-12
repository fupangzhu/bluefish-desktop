//! motion.mjs: timed parameter curves played on top of her motion (the editor's 导入动作 JSON and
//! 播放适配示例), and the PromptSoul segment adapter.
use serde_json::Value;

/// ParamAngleX, ParamAngleY, ParamAngleZ, ParamEyeLOpen, ParamEyeROpen, ParamEyeBallX, ParamEyeBallY.
pub const PARAMETERS: [&str; 7] = ["ParamAngleX", "ParamAngleY", "ParamAngleZ", "ParamEyeLOpen", "ParamEyeROpen", "ParamEyeBallX", "ParamEyeBallY"];

#[derive(Clone, Debug)]
pub struct Cue {
    pub duration: f64,
    pub curves: Vec<(usize, Vec<(f64, f64)>)>,
}
#[derive(Clone, Debug)]
pub struct Queued {
    pub cue: Cue,
    pub start: f64,
    pub end: f64,
}

pub fn validate_cue(v: &Value) -> Result<Cue, String> {
    let shape = "动作需要 0–30 秒时长和 1–40 条曲线".to_string();
    let duration = v["duration"].as_f64().filter(|d| d.is_finite() && *d > 0.0 && *d <= 30.0).ok_or(shape.clone())?;
    let curves = v["curves"].as_array().filter(|c| !c.is_empty() && c.len() <= 40).ok_or(shape)?;
    let mut seen = Vec::new();
    let mut out = Vec::new();
    for c in curves {
        let p = c["parameter"].as_str().and_then(|p| PARAMETERS.iter().position(|x| *x == p));
        let keys = c["keys"].as_array().filter(|k| k.len() >= 3 && k.len() <= 64);
        let (Some(p), Some(keys)) = (p, keys) else { return Err("未知、重复参数或关键帧数量错误".into()) };
        if seen.contains(&p) {
            return Err("未知、重复参数或关键帧数量错误".into());
        }
        seen.push(p);
        let mut prev = -1.0;
        let mut ks = Vec::new();
        for k in keys {
            let pair = k.as_array().filter(|a| a.len() == 2).and_then(|a| Some((a[0].as_f64()?, a[1].as_f64()?)));
            let bad = || "关键帧时间必须在 0–1 内递增，偏移不得超出数值范围".to_string();
            let (t, val) = pair.ok_or_else(bad)?;
            if !t.is_finite() || !val.is_finite() || val.abs() > 1_000_000.0 || !(0.0..=1.0).contains(&t) || t <= prev {
                return Err(bad());
            }
            prev = t;
            ks.push((t, val));
        }
        if ks[0].0 != 0.0 || ks.last().unwrap().0 != 1.0 || ks[0].1 != 0.0 || ks.last().unwrap().1 != 0.0 {
            return Err("临时动作必须从零偏移开始并回到零".into());
        }
        out.push((p, ks));
    }
    Ok(Cue { duration, curves: out })
}

/// The offsets a cue adds at `elapsed` seconds (smoothstep between keys).
pub fn cue_sample(cue: &Cue, elapsed: f64) -> Vec<(usize, f64)> {
    if elapsed < 0.0 || elapsed >= cue.duration {
        return Vec::new();
    }
    let phase = elapsed / cue.duration;
    let mut out = Vec::new();
    for (p, keys) in &cue.curves {
        for w in keys.windows(2) {
            let (a, b) = (w[0], w[1]);
            if phase > b.0 {
                continue;
            }
            let mut t = (phase - a.0) / (b.0 - a.0);
            t = t * t * (3.0 - 2.0 * t);
            out.push((*p, a.1 + (b.1 - a.1) * t));
            break;
        }
    }
    out
}

/// One already-resolved PromptSoul segment: up to three cues placed inside `duration` seconds.
pub fn from_promptsoul_segment(segment: &Value, duration: f64) -> Result<Vec<(f64, Cue)>, String> {
    let cues = segment["cues"].as_array().filter(|c| c.len() <= 3);
    let seq_ok = segment["seq"].as_f64().is_some_and(|s| s >= 0.0 && s.fract() == 0.0 && s <= 9_007_199_254_740_991.0);
    let (Some(cues), true) = (cues, seq_ok) else { return Err("不是有效的 PromptSoul segment".into()) };
    cues.iter()
        .map(|c| {
            let (at, span) = (c["at"].as_f64().unwrap_or(f64::NAN), c["span"].as_f64().unwrap_or(f64::NAN));
            if !at.is_finite() || !span.is_finite() || at < 0.0 || span <= 0.0 || at + span > 1.0 {
                return Err("cue 时间超出片段".to_string());
            }
            let cue = validate_cue(&serde_json::json!({"duration": span * duration, "curves": c["curves"]}))?;
            Ok((at * duration, cue))
        })
        .collect()
}
