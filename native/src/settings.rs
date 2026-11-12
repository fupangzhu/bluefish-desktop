//! window.json: size, position and switches. Kept in its own folder; the first run imports the
//! Electron build's choices so switching versions keeps her size and habits.
use crate::dock::clamp_size;
use crate::pet::Settings;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Saved {
    #[serde(rename = "layoutVersion", default)]
    pub layout_version: u32,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub size: Option<f64>,
    pub docked: Option<bool>,
    pub follow: Option<bool>,
    pub idle: Option<bool>,
}

pub fn folder() -> PathBuf {
    let base = std::env::var_os("BLUEFISH_NATIVE_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("bluefish-native"));
    base
}
fn file() -> PathBuf {
    folder().join("window.json")
}
fn read(path: &std::path::Path) -> Option<Saved> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// The saved settings and window position (screen DIP), if any.
pub fn load() -> (Settings, Option<(f64, f64)>) {
    let mut s = Settings::default();
    let own = read(&file());
    let saved = own.clone().or_else(|| {
        // First run: borrow the Electron build's switches (not its position: its DIP space differs).
        let appdata = PathBuf::from(std::env::var_os("APPDATA")?);
        read(&appdata.join("bluefish-complete").join("window.json")).map(|e| Saved { x: None, y: None, ..e })
    });
    let Some(p) = saved else { return (s, None) };
    if let Some(v) = p.size {
        s.size = clamp_size(v);
    }
    if let Some(v) = p.docked {
        s.docked = v;
    }
    if let Some(v) = p.follow {
        s.follow = v;
    }
    if let Some(v) = p.idle {
        s.idle = v;
    }
    let pos = match (p.x, p.y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() && own.is_some() => Some((x, y)),
        _ => None,
    };
    (s, pos)
}

pub fn save(s: &Settings, x: f64, y: f64) {
    let data = Saved { layout_version: 2, x: Some(x), y: Some(y), size: Some(s.size), docked: Some(s.docked), follow: Some(s.follow), idle: Some(s.idle) };
    let _ = std::fs::create_dir_all(folder());
    if let Ok(text) = serde_json::to_vec(&data) {
        let tmp = file().with_extension("json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, file());
        }
    }
}
