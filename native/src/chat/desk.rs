//! desktop/tools.cjs and src/agent/desk.mjs: her hands and eyes. A screenshot, or what a window
//! shows, through the agent-desktop CLI (one process per call, hard timeout). Read-only.
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const MAX_NODES: usize = 40;
const MAX_CHARS: usize = 1200;
const MAX_DEPTH: u32 = 8;
const TIMEOUT: Duration = Duration::from_secs(25);

pub struct Desk {
    pub bin: Option<PathBuf>,
    pub shot_dir: PathBuf,
}
pub struct Shot {
    pub path: PathBuf,
    /// For the vision model: a PNG data URL, at most 1600 px wide.
    pub data_url: String,
}

impl Desk {
    pub fn find() -> Desk {
        let bin = std::env::var_os("APPDATA")
            .map(|a| PathBuf::from(a).join("npm").join("node_modules").join("agent-desktop").join("bin").join("agent-desktop-win32-x64.exe"))
            .filter(|p| p.exists());
        let pictures = std::env::var_os("USERPROFILE").map(|u| PathBuf::from(u).join("Pictures")).unwrap_or_default();
        Desk { bin, shot_dir: pictures.join("小鱼截图") }
    }
    fn call(&self, args: &[String]) -> Result<Value, String> {
        let bin = self.bin.as_ref().ok_or("这台机器上没找到 agent-desktop")?;
        let mut cmd = Command::new(bin);
        cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("启动 agent-desktop 失败：{e}"))?;
        let start = Instant::now();
        loop {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                break;
            }
            if start.elapsed() > TIMEOUT {
                let _ = child.kill();
                return Err("agent-desktop 超时".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let env = parse_envelope(&stdout);
        if let Some(e) = env.as_ref().filter(|e| e["ok"] == Value::Bool(true)) {
            return Ok(e["data"].clone());
        }
        let why = env
            .and_then(|e| e["error"]["message"].as_str().map(String::from))
            .unwrap_or_else(|| {
                let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if err.is_empty() {
                    format!("agent-desktop 退出码 {:?}", out.status.code())
                } else {
                    err
                }
            });
        Err(why.chars().take(200).collect())
    }
    fn shot_file(&self, app: Option<&str>) -> Result<(PathBuf, Value), String> {
        std::fs::create_dir_all(&self.shot_dir).map_err(|e| e.to_string())?;
        let file = self.shot_dir.join(shot_name());
        let mut args = vec!["screenshot".to_string(), file.to_string_lossy().into_owned()];
        if let Some(a) = app {
            args.push("--app".into());
            args.push(a.into());
        }
        let data = self.call(&args)?;
        Ok((file, data))
    }
    pub fn screenshot(&self, app: Option<&str>) -> Result<String, String> {
        if self.bin.is_none() {
            return Ok("这台机器上没找到 agent-desktop，暂时不能截图。".into());
        }
        let (file, data) = self.shot_file(app)?;
        let copied = copy_image(&file);
        let size = match (data["width"].as_u64(), data["height"].as_u64()) {
            (Some(w), Some(h)) => format!("，{w}×{h}"),
            _ => String::new(),
        };
        let wher = app.map(|a| format!("（{a}）")).unwrap_or_else(|| "（整个屏幕）".into());
        Ok(format!("截图好了{wher}{size}，存在 {}，也放进了剪贴板，可以直接粘贴。{}", file.display(), if copied { "" } else { "（剪贴板没写成，直接打开文件吧）" }))
    }
    pub fn capture(&self, app: Option<&str>) -> Result<Shot, String> {
        if self.bin.is_none() {
            return Err("这台机器上没找到 agent-desktop".into());
        }
        let (file, _) = self.shot_file(app)?;
        let img = crate::render::texture::Image::load_png(&file).map_err(|_| "截图读不出来".to_string())?;
        let png = downscale_png(&img, 1600);
        use base64::Engine;
        Ok(Shot { path: file, data_url: format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)) })
    }
    pub fn look(&self, app: Option<&str>) -> Result<String, String> {
        if self.bin.is_none() {
            return Ok("这台机器上没找到 agent-desktop，暂时看不了屏幕。".into());
        }
        let mut args: Vec<String> = ["snapshot", "--compact", "--max-depth"].iter().map(|s| s.to_string()).collect();
        args.push(MAX_DEPTH.to_string());
        match app {
            Some(a) => args.extend(["--app".into(), a.into()]),
            None => args.extend(["--surface".into(), "focused".into()]),
        }
        let data = self.call(&args)?;
        let (title, count, text) = outline(&data);
        let title = if title.is_empty() { "当前窗口".into() } else { title };
        Ok(if count == 0 {
            format!("没读出「{title}」里的控件——这个界面可能没有无障碍信息，我可以改成截图给你。")
        } else {
            format!("「{title}」里能读到 {count} 个元素：\n{text}")
        })
    }
}

pub fn parse_envelope(stdout: &str) -> Option<Value> {
    stdout.lines().rev().filter(|l| l.trim_start().starts_with('{')).find_map(|l| serde_json::from_str::<Value>(l).ok().filter(|v| v.get("ok").is_some()))
}
fn flatten(node: &Value, out: &mut Vec<(String, String)>) {
    if out.len() >= MAX_NODES || node.is_null() {
        return;
    }
    let name = node["name"].as_str().unwrap_or("").trim().to_string();
    if !name.is_empty() {
        out.push((node["role"].as_str().unwrap_or("").to_string(), name));
    }
    for kid in node["children"].as_array().into_iter().flatten() {
        if out.len() >= MAX_NODES {
            break;
        }
        flatten(kid, out);
    }
}
pub fn outline(data: &Value) -> (String, usize, String) {
    let roots: Vec<&Value> = match &data["tree"] {
        Value::Array(a) => a.iter().collect(),
        Value::Null => Vec::new(),
        v => vec![v],
    };
    let mut nodes = Vec::new();
    for r in roots {
        let mut part = Vec::new();
        flatten(r, &mut part);
        nodes.extend(part);
    }
    nodes.truncate(MAX_NODES);
    let mut text = nodes.iter().map(|(r, n)| format!("{r}：{n}")).collect::<Vec<_>>().join("\n");
    if text.chars().count() > MAX_CHARS {
        text = text.chars().take(MAX_CHARS).collect::<String>() + "…";
    }
    (data["window"]["title"].as_str().unwrap_or("").trim().to_string(), nodes.len(), text)
}
fn shot_name() -> String {
    let now = super::text::now_ms();
    let (y, mo, d, _, h, mi) = super::text::local(now);
    let s = ((now / 1000.0) as u64) % 60;
    format!("shot-{y}{mo:02}{d:02}-{h:02}{mi:02}{s:02}.png")
}
/// The Windows clipboard through PowerShell: boring but reliable.
fn copy_image(file: &Path) -> bool {
    let escaped = file.to_string_lossy().replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $img=[System.Drawing.Image]::FromFile('{escaped}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()"
    );
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-STA", "-Command", &script]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.status().is_ok_and(|s| s.success())
}
fn downscale_png(img: &crate::render::texture::Image, max_w: usize) -> Vec<u8> {
    let k = (img.w as f64 / max_w as f64).max(1.0);
    let (w, h) = (((img.w as f64) / k).round().max(1.0) as usize, ((img.h as f64) / k).round().max(1.0) as usize);
    let mut rgb = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        for x in 0..w {
            let (sx, sy) = (((x as f64 + 0.5) * k) as usize, ((y as f64 + 0.5) * k) as usize);
            let i = (sy.min(img.h - 1) * img.w + sx.min(img.w - 1)) * 4;
            rgb.extend_from_slice(&img.px[i..i + 3]);
        }
    }
    let mut out = Vec::new();
    {
        let mut e = png::Encoder::new(&mut out, w as u32, h as u32);
        e.set_color(png::ColorType::Rgb);
        e.set_depth(png::BitDepth::Eight);
        if let Ok(mut wr) = e.write_header() {
            let _ = wr.write_image_data(&rgb);
        }
    }
    out
}
