//! Bluefish desktop pet (native). Looks for `assets/` next to the executable, then in the parent
//! folders (so `cargo run` from the repository works).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn assets() -> Option<std::path::PathBuf> {
    if let Some(p) = std::env::var_os("BLUEFISH_ASSETS") {
        return Some(p.into());
    }
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().skip(1).map(|d| d.join("assets")).find(|d| d.join("rig.json").exists())
}

fn main() {
    let Some(dir) = assets() else {
        eprintln!("assets/rig.json not found");
        std::process::exit(1);
    };
    #[cfg(windows)]
    if std::env::args().any(|a| a == "--editor") {
        if let Err(e) = bluefish::win::editor::run(&dir) {
            eprintln!("bluefish editor: {e}");
            std::process::exit(1);
        }
        return;
    }
    #[cfg(windows)]
    if let Err(e) = bluefish::win::run(&dir) {
        eprintln!("bluefish: {e}");
        std::process::exit(1);
    }
}
