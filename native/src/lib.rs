//! Bluefish, native Windows build. See docs/superpowers/specs/2026-11-11-rust-native-design.md.
pub mod chat;
pub mod dock;
pub mod hands;
pub mod motion;
pub mod pet;
pub mod render;
pub mod settings;
#[cfg(windows)]
pub mod ui;
pub mod util;
#[cfg(windows)]
pub mod win;
