//! BLUEFISH_SMOKE=<out.json>: drives the real window with a pretend cursor (carry her along the
//! taskbar, lift her off it, put her back, tow her by the ahoge, a plain click) and writes what
//! happened, then quits. test/native-smoke.cjs checks the result.
use super::{App, Input, FAKE_CURSOR};
use crate::dock::Rect;
use serde_json::{json, Map, Value};

#[derive(Clone)]
enum Step {
    Wait(f64),
    Grab(&'static str),
    Move(f64, f64, usize),
    Release,
    Note(&'static str),
    // chat
    Configure,
    Type(&'static str),
    Act(super::bubble::Action),
    ChatNote(&'static str),
    MenuShot,
}
pub struct Smoke {
    out: std::path::PathBuf,
    plan: Vec<Step>,
    i: usize,
    until: f64,
    left: usize,
    cursor: (f64, f64),
    log: Map<String, Value>,
    failed: Option<String>,
}
fn rect(r: Rect) -> Value {
    json!({"x": r.x, "y": r.y, "width": r.width, "height": r.height})
}
impl Smoke {
    pub fn from_env() -> Option<Smoke> {
        use Step::*;
        if let Some(out) = std::env::var_os("BLUEFISH_SMOKE_CHAT") {
            // Chat: settings through the settings window, a click opens the bubble, a line
            // typed into it is answered, WeChat connects and answers, the model list comes back.
            let plan = vec![
                Wait(1.5),
                Configure,
                Wait(0.5),
                ChatNote("configured"),
                Grab("body"),
                Wait(0.08),
                Release,
                Wait(0.2),
                ChatNote("beforeConfirm"),
                Wait(0.6),
                ChatNote("afterClick"),
                Type("在吗"),
                Act(super::bubble::Action::Send("在吗".into())),
                Wait(7.0),
                ChatNote("answered"),
                Act(super::bubble::Action::Weixin),
                Wait(12.0),
                ChatNote("weixin"),
                Act(super::bubble::Action::OpenSettings),
                Act(super::bubble::Action::FetchModels),
                Wait(2.0),
                ChatNote("models"),
                MenuShot,
            ];
            return Some(Smoke { out: out.into(), plan, i: 0, until: 0.0, left: 0, cursor: (0.0, 0.0), log: Map::new(), failed: None });
        }
        let out = std::env::var_os("BLUEFISH_SMOKE")?.into();
        let plan = vec![
            Wait(1.5),
            Note("start"),
            // Carry her right along the taskbar.
            Grab("body"),
            Move(4.0, 0.0, 45),
            Release,
            Wait(0.6),
            Note("carried"),
            // Lift her off the taskbar, then put her back down.
            Grab("body"),
            Move(0.0, -15.0, 14),
            Move(5.0, 0.0, 10),
            Release,
            Wait(0.6),
            Note("lifted"),
            Grab("body"),
            Move(0.0, 20.0, 20),
            Release,
            Wait(0.6),
            Note("docked"),
            // Tow her by the ahoge, then let go and let her settle.
            Grab("ahoge"),
            Move(7.0, 0.0, 50),
            Release,
            Wait(3.0),
            Note("towed"),
            // A plain click is not a drag.
            Grab("body"),
            Wait(0.08),
            Release,
            Wait(0.7),
            Note("clicked"),
        ];
        Some(Smoke { out, plan, i: 0, until: 0.0, left: 0, cursor: (0.0, 0.0), log: Map::new(), failed: None })
    }
    fn client(app: &App, p: (f64, f64)) -> (i32, i32) {
        (((p.0 - app.bounds.x) * app.scale).round() as i32, ((p.1 - app.bounds.y) * app.scale).round() as i32)
    }
    pub fn step(&mut self, app: &mut App) {
        let now = app.now();
        if now < self.until {
            return;
        }
        let Some(step) = self.plan.get(self.i) else {
            self.finish(app);
            return;
        };
        match step.clone() {
            Step::Wait(t) => {
                self.until = now + t;
                self.i += 1;
            }
            Step::Note(name) => {
                let s = app.pet.settings;
                self.log.insert(
                    name.into(),
                    json!({"bounds": rect(app.bounds), "docked": s.docked, "dragging": app.drag.is_some(), "petDrag": app.pet.dragging(), "lastClick": app.pet.last_click}),
                );
                self.i += 1;
            }
            Step::Grab(what) => {
                let Some((x, y)) = app.pet.find_point(&app.frame, what) else {
                    self.failed = Some(format!("no {what} point to grab"));
                    self.i = self.plan.len();
                    return;
                };
                self.cursor = (app.bounds.x + x, app.bounds.y + y);
                FAKE_CURSOR.with(|c| c.set(Some(self.cursor)));
                let (cx, cy) = Self::client(app, self.cursor);
                super::push(Input::Down(cx, cy));
                self.log.insert(format!("grab:{what}"), json!([x, y]));
                self.until = now + 0.05;
                self.i += 1;
            }
            Step::Move(dx, dy, n) => {
                if self.left == 0 {
                    self.left = n;
                }
                self.cursor = (self.cursor.0 + dx, self.cursor.1 + dy);
                FAKE_CURSOR.with(|c| c.set(Some(self.cursor)));
                let (cx, cy) = Self::client(app, self.cursor);
                super::push(Input::Move(cx, cy));
                self.until = now + 1.0 / 60.0;
                self.left -= 1;
                if self.left == 0 {
                    self.i += 1;
                }
            }
            Step::MenuShot => {
                app.menu();
                if let (Some(path), Some(m)) = (std::env::var_os("BLUEFISH_SMOKE_SHOTS"), app.menu.as_ref()) {
                    m.win.save_png(&std::path::PathBuf::from(path).join("menu.png"), super::menu::MENU_H);
                }
                self.log.insert("menuVisible".into(), json!(app.menu.as_ref().is_some_and(|m| m.win.visible())));
                app.hide_menu();
                self.i += 1;
            }
            Step::Configure => {
                // Fill the settings panel the way a person would, then press 保存.
                let base = std::env::var("BLUEFISH_SMOKE_MODEL").unwrap_or_default();
                app.show_bubble(super::bubble::Mode::Chat, true);
                if let Some(b) = app.bubble.as_mut() {
                    b.v.base.set(&base);
                    b.v.key.set("smoke-key");
                    b.v.model.set("fake-model");
                    b.v.proxy.set("");
                }
                app.bubble_act(super::bubble::Action::Save);
                app.hide_bubble();
                self.until = now + 0.1;
                self.i += 1;
            }
            Step::Type(t) => {
                if let Some(b) = app.bubble.as_mut() {
                    b.v.input.set(t);
                }
                self.i += 1;
            }
            Step::Act(a) => {
                app.bubble_act(a);
                if app.bubble_visible() {
                    app.place_bubble();
                }
                self.until = now + 0.1;
                self.i += 1;
            }
            Step::ChatNote(name) => {
                let lines: Vec<String> = app.bubble.as_ref().map(|b| b.v.lines.iter().map(|l| format!("{}:{}:{}", l.who, l.channel, l.text)).collect()).unwrap_or_default();
                let chat = app.chat.as_ref().unwrap();
                let (has_key, model) = {
                    let s = chat.shared.settings.lock().unwrap();
                    (!s.api_key.is_empty(), s.config.model.clone())
                };
                let wx = chat.shared.weixin.status();
                let (usage, error) = app.bubble.as_ref().map(|b| (b.v.usage.clone(), b.v.error.clone())).unwrap_or_default();
                let dir = crate::settings::folder().join("brain");
                let disk = [dir.join("config.json"), dir.join("weixin.json")].iter().map(|p| std::fs::read_to_string(p).unwrap_or_default()).collect::<String>();
                self.log.insert(
                    name.into(),
                    json!({"bubbleVisible": app.bubble_visible(), "mode": format!("{:?}", app.bubble_mode()), "lines": lines,
                        "hasKey": has_key, "model": model, "weixin": wx.state, "canSend": wx.can_send, "usageText": usage, "lastClick": app.pet.last_click,
                        "plainSecret": disk.contains("smoke-key") || disk.contains("BOT-TOKEN"), "settingsError": error,
                        "bubbleHeight": app.bubble.as_ref().map(|b| b.height)}),
                );
                if let Some(path) = std::env::var_os("BLUEFISH_SMOKE_SHOTS") {
                    if let Some(b) = &app.bubble {
                        b.win.save_png(&std::path::PathBuf::from(path).join(format!("bubble-{name}.png")), b.height);
                    }
                }
                self.i += 1;
            }
            Step::Release => {
                let (cx, cy) = Self::client(app, self.cursor);
                super::push(Input::Up(cx, cy));
                self.until = now + 0.05;
                self.i += 1;
            }
        }
    }
    fn finish(&mut self, app: &mut App) {
        self.log.insert("error".into(), self.failed.clone().map_or(Value::Null, Value::from));
        let _ = std::fs::write(&self.out, serde_json::to_vec_pretty(&Value::Object(self.log.clone())).unwrap_or_default());
        app.quit = true;
    }
}
