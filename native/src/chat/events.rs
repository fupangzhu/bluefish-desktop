//! events.mjs: the append-only event stream (one JSON object per line), the single source of truth
//! for what was said and done. Same file format as the Electron build, so history carries over.
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Event {
    #[serde(default = "one")]
    pub v: u32,
    pub seq: u64,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub ts: f64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub channel: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub action: String,
}
fn one() -> u32 {
    1
}

pub struct EventStore {
    file: Option<PathBuf>,
    keep: usize,
    pub events: Vec<Event>,
    seq: u64,
}
impl EventStore {
    pub fn open(file: Option<PathBuf>) -> EventStore {
        let mut s = EventStore { file, keep: 2000, events: Vec::new(), seq: 0 };
        if let Some(f) = &s.file {
            if let Ok(text) = std::fs::read_to_string(f) {
                for line in text.lines().filter(|l| !l.trim().is_empty()) {
                    if let Ok(e) = serde_json::from_str::<Event>(line) {
                        s.seq = s.seq.max(e.seq);
                        s.events.push(e);
                    }
                }
            }
            if s.events.len() > s.keep {
                s.events.drain(..s.events.len() - s.keep);
            }
        }
        s
    }
    pub fn append(&mut self, kind: &str, channel: &str, text: &str, action: &str) -> Event {
        self.seq += 1;
        let e = Event {
            v: 1,
            seq: self.seq,
            id: format!("{:016x}{:08x}", super::text::now_ms() as u64, rand_u32()),
            ts: super::text::now_ms(),
            kind: kind.into(),
            channel: channel.into(),
            text: text.into(),
            action: action.into(),
        };
        self.events.push(e.clone());
        if self.events.len() > self.keep {
            self.events.remove(0);
        }
        if let Some(f) = &self.file {
            if let Some(dir) = f.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(f) {
                if let Ok(line) = serde_json::to_string(&e) {
                    let _ = writeln!(file, "{line}");
                }
            }
        }
        e
    }
    pub fn recent(&self, n: usize) -> &[Event] {
        &self.events[self.events.len().saturating_sub(n)..]
    }
    pub fn last_seq(&self) -> u64 {
        self.events.last().map_or(0, |e| e.seq)
    }
}
pub fn rand_u32() -> u32 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.finish() as u32
}
