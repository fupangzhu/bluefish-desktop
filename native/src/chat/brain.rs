//! brain.mjs: debounce -> planner (tools) -> replyer -> paced lines. Runs on its own thread. Every
//! slow call (model, WeChat, desktop tools) runs on a helper thread while this one keeps receiving,
//! so words from the owner are recorded at once and interrupt a planner call on the same channel.
use super::events::Event;
use super::llm::{self, Kind, LlmError, Reply};
use super::text::{self, action_name, planner_system, planner_tools, replyer_system, replyer_user, situation, split_reply, typing_delay, Debounce, ACTIONS};
use super::{Out, Shared};
use serde_json::{json, Value};
use std::any::Any;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

const MAX_ROUNDS: usize = 4;
const HISTORY: usize = 24;

pub enum In {
    Heard(String, String),
    Typing,
    Stop,
    Done(u64, Box<dyn Any + Send>),
}

pub struct Brain {
    rx: Receiver<In>,
    me: Sender<In>,
    out: Box<dyn Fn(Out) + Send>,
    shared: Arc<Shared>,
    debounce: Debounce,
    channel: String,
    turn_channel: Option<String>,
    handled_seq: u64,
    interrupt: bool,
    running: bool,
    stopped: bool,
    job: u64,
    clock: Instant,
}

fn secs(i: &Instant) -> f64 {
    i.elapsed().as_secs_f64()
}

impl Brain {
    pub fn new(rx: Receiver<In>, me: Sender<In>, out: Box<dyn Fn(Out) + Send>, shared: Arc<Shared>) -> Brain {
        let handled_seq = shared.store.lock().unwrap().last_seq();
        Brain {
            rx,
            me,
            out,
            shared,
            debounce: Debounce::default(),
            channel: "desktop".into(),
            turn_channel: None,
            handled_seq,
            interrupt: false,
            running: false,
            stopped: false,
            job: 0,
            clock: Instant::now(),
        }
    }
    pub fn run(mut self) {
        loop {
            let wait = self.debounce.deadline.map(|d| (d - secs(&self.clock)).max(0.0)).unwrap_or(3600.0);
            match self.rx.recv_timeout(Duration::from_secs_f64(wait)) {
                Ok(m) => {
                    if !self.take(m) {
                        return;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if self.debounce.due(secs(&self.clock)) {
                self.turn();
            }
            if self.stopped {
                return;
            }
        }
    }
    /// Handles one message from outside; false once told to stop.
    fn take(&mut self, m: In) -> bool {
        match m {
            In::Heard(text, channel) => self.receive(&text, &channel),
            In::Typing => {
                self.debounce.typing(secs(&self.clock));
            }
            In::Stop => {
                self.stopped = true;
                return false;
            }
            In::Done(..) => {} // a result nobody waits for any more
        }
        true
    }
    fn receive(&mut self, text: &str, channel: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let t: String = text.chars().take(2000).collect();
        self.shared.store.lock().unwrap().append("heard", channel, &t, "");
        self.channel = channel.into();
        // Words on the turn's own channel interrupt it; another channel waits its turn.
        if self.running && self.turn_channel.as_deref() == Some(channel) {
            self.interrupt = true;
        }
        self.debounce.push(secs(&self.clock));
    }
    fn say(&self, o: Out) {
        (self.out)(o);
    }

    /// Runs `job` on a helper thread while still taking messages. None when interrupted (only if
    /// `abortable`) or stopped.
    fn pump<T: Send + 'static>(&mut self, job: impl FnOnce() -> T + Send + 'static, abortable: bool) -> Option<T> {
        self.job += 1;
        let id = self.job;
        let me = self.me.clone();
        std::thread::spawn(move || {
            let r = job();
            let _ = me.send(In::Done(id, Box::new(r)));
        });
        loop {
            match self.rx.recv() {
                Ok(In::Done(i, v)) if i == id => return v.downcast::<T>().ok().map(|b| *b),
                Ok(m) => {
                    if !self.take(m) {
                        return None;
                    }
                    if abortable && self.interrupt {
                        return None;
                    }
                }
                Err(_) => {
                    self.stopped = true;
                    return None;
                }
            }
        }
    }
    /// Sleeps while still taking messages; false when cut short.
    fn sleep(&mut self, d: Duration, abortable: bool) -> bool {
        let end = Instant::now() + d;
        loop {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return true;
            }
            match self.rx.recv_timeout(left) {
                Ok(m) => {
                    if !self.take(m) {
                        return false;
                    }
                    if abortable && self.interrupt {
                        return false;
                    }
                }
                Err(RecvTimeoutError::Timeout) => return true,
                Err(RecvTimeoutError::Disconnected) => return false,
            }
        }
    }

    fn last_heard_seq(&self) -> u64 {
        self.shared.store.lock().unwrap().recent(40).iter().rev().find(|e| e.kind == "heard").map_or(0, |e| e.seq)
    }
    fn last_seq(&self) -> u64 {
        self.shared.store.lock().unwrap().last_seq()
    }
    fn talk(&self) -> Vec<Event> {
        self.shared.store.lock().unwrap().recent(HISTORY + 40).iter().filter(|e| matches!(e.kind.as_str(), "heard" | "said" | "acted")).cloned().collect()
    }
    fn planner_messages(&self, start: u64) -> Value {
        let events = self.talk();
        let history: Vec<Event> = events.iter().filter(|e| e.seq <= start).cloned().collect();
        let history = history[history.len().saturating_sub(HISTORY)..].to_vec();
        let fresh: Vec<Event> = events.into_iter().filter(|e| e.seq > start).collect();
        let persona = self.shared.settings.lock().unwrap().config.persona.clone();
        json!([
            {"role": "system", "content": planner_system(&persona)},
            {"role": "user", "content": situation(text::now_ms(), &self.channel, &history, &fresh)}
        ])
    }
    /// A model call with the current settings (copied, so the settings are not held during it).
    fn model_job(&self, messages: Value, tools: bool, temperature: f64, max_tokens: u32, thinking: Option<Value>) -> impl FnOnce() -> Result<Reply, LlmError> + Send + 'static {
        let (base, key, model, proxy) = {
            let s = self.shared.settings.lock().unwrap();
            (s.config.base_url.clone(), s.api_key.clone(), s.config.model.clone(), s.config.proxy.clone())
        };
        let shared = self.shared.clone();
        move || {
            let tools_v = planner_tools();
            let r = llm::chat(&llm::Request {
                base_url: &base,
                api_key: &key,
                model: &model,
                proxy: &proxy,
                messages: &messages,
                tools: if tools { Some(&tools_v) } else { None },
                temperature,
                max_tokens,
                thinking,
            });
            if let Ok(r) = &r {
                shared.settings.lock().unwrap().spend(r.total_tokens);
            }
            r
        }
    }

    fn turn(&mut self) {
        if self.running || self.stopped || self.last_heard_seq() <= self.handled_seq {
            return;
        }
        self.running = true;
        let start = self.handled_seq;
        self.handled_seq = self.last_seq();
        let channel = self.channel.clone();
        self.turn_channel = Some(channel.clone());
        if let Err(e) = self.turn_inner(start, &channel) {
            self.say(Out::Act("shakehead".into()));
            let settings = matches!(e.kind, Kind::Config | Kind::Auth);
            let text = if e.kind == Kind::Config { format!("{}，请在设置里填好。", e.message) } else { format!("出错了：{}", e.message) };
            self.say(Out::Notice { text, settings });
        }
        self.typing(false, &channel);
        self.say(Out::State("idle".into()));
        self.running = false;
        self.turn_channel = None;
    }
    fn turn_inner(&mut self, start: u64, channel: &str) -> Result<(), LlmError> {
        if self.shared.settings.lock().unwrap().exhausted() {
            self.say(Out::Act("shakehead".into()));
            self.say(Out::Notice { text: "今天聊得太多了，模型额度用完了，明天再聊吧。".into(), settings: false });
            return Ok(());
        }
        self.say(Out::State("thinking".into()));
        let mut messages = self.planner_messages(start);
        let mut rounds = 0;
        let mut spoke = false;
        while rounds < MAX_ROUNDS && !self.stopped {
            rounds += 1;
            self.interrupt = false;
            let job = self.model_job(messages.clone(), true, 0.7, 600, None);
            let Some(res) = self.pump(job, true) else {
                if self.stopped {
                    break;
                }
                // New words arrived while she was thinking: think again with them.
                self.handled_seq = self.last_seq();
                messages = self.planner_messages(start);
                rounds -= 1;
                continue;
            };
            let res = res?;
            if res.tool_calls.is_empty() {
                break;
            }
            let raw: Vec<Value> = res.tool_calls.iter().map(|c| c.raw.clone()).collect();
            messages.as_array_mut().unwrap().push(json!({"role": "assistant", "content": res.content, "tool_calls": raw}));
            let (mut end, mut waited, mut spoke_now) = (false, false, false);
            for call in &res.tool_calls {
                let out = match call.name.as_str() {
                    "stop" => {
                        end = true;
                        "好".to_string()
                    }
                    "act" => self.do_act(&call.args, channel),
                    "reply" => {
                        let r = self.do_reply(&call.args, channel, spoke)?;
                        if r.1 {
                            spoke = true;
                            spoke_now = true;
                        }
                        r.0
                    }
                    "wait" => {
                        waited = true;
                        self.do_wait(&call.args)
                    }
                    "screenshot" | "look" | "see" => self.do_tool(&call.name, &call.args, channel),
                    _ => "没有这个工具".into(),
                };
                messages.as_array_mut().unwrap().push(json!({"role": "tool", "tool_call_id": call.id, "content": out}));
            }
            if end {
                break;
            }
            // Once she has spoken (and is not waiting), the turn is over.
            if spoke_now && !waited && !self.interrupt {
                break;
            }
            if self.interrupt {
                self.handled_seq = self.last_seq();
                messages = self.planner_messages(start);
            }
        }
        Ok(())
    }
    fn typing(&self, on: bool, channel: &str) {
        if channel == "weixin" {
            let wx = self.shared.weixin.clone();
            std::thread::spawn(move || wx.typing(on));
        }
        self.say(Out::Typing(on));
    }
    fn do_act(&mut self, args: &Value, channel: &str) -> String {
        let action = args["action"].as_str().unwrap_or("");
        let Some(name) = action_name(action) else {
            return format!("做不了这个动作，可选：{}", ACTIONS.iter().map(|a| a.0).collect::<Vec<_>>().join("/"));
        };
        self.say(Out::Act(action.into()));
        self.shared.store.lock().unwrap().append("acted", channel, "", action);
        format!("做了：{name}")
    }
    fn do_reply(&mut self, args: &Value, channel: &str, spoke: bool) -> Result<(String, bool), LlmError> {
        if spoke {
            return Ok(("这一轮已经说过话了".into(), false));
        }
        let reference: String = args["reference"].as_str().unwrap_or("").chars().take(400).collect();
        let tone: String = args["tone"].as_str().unwrap_or("").chars().take(40).collect();
        let talk = self.talk();
        let history = talk[talk.len().saturating_sub(HISTORY)..].to_vec();
        let persona = self.shared.settings.lock().unwrap().config.persona.clone();
        self.typing(true, channel);
        let messages = json!([
            {"role": "system", "content": replyer_system(&persona)},
            {"role": "user", "content": replyer_user(text::now_ms(), &history, &reference, &tone)}
        ]);
        let job = self.model_job(messages, false, 0.9, 300, Some(json!({"type": "disabled"})));
        let Some(res) = self.pump(job, false) else { return Ok(("没说成".into(), false)) };
        let lines = split_reply(&res?.content);
        if lines.is_empty() {
            self.typing(false, channel);
            return Ok(("没想好说什么，什么都没说".into(), false));
        }
        for (i, line) in lines.iter().enumerate() {
            if i > 0 {
                self.typing(true, channel);
            }
            self.sleep(Duration::from_secs_f64(typing_delay(line)), false);
            self.typing(false, channel);
            if channel == "weixin" {
                let wx = self.shared.weixin.clone();
                let l = line.clone();
                match self.pump(move || wx.send(&l).map_err(|e| e.message), false) {
                    Some(Ok(())) => {}
                    Some(Err(e)) => {
                        self.say(Out::Notice { text: format!("没能发出去：{e}"), settings: false });
                        break;
                    }
                    None => break,
                }
            }
            self.say(Out::Say { text: line.clone(), channel: channel.into() });
            self.shared.store.lock().unwrap().append("said", channel, line, "");
        }
        Ok((format!("说了：{}", lines.join(" ")), true))
    }
    fn do_wait(&mut self, args: &Value) -> String {
        let s = args["seconds"].as_f64().filter(|s| *s != 0.0 && s.is_finite()).unwrap_or(10.0).clamp(5.0, 120.0);
        if self.interrupt {
            return "等的时候主人说话了".into();
        }
        if self.sleep(Duration::from_secs_f64(s), true) {
            format!("等了 {s} 秒，主人没有说话")
        } else {
            "等的时候主人说话了".into()
        }
    }
    fn do_tool(&mut self, name: &str, args: &Value, channel: &str) -> String {
        let app = args["app"].as_str().map(|a| a.trim().chars().take(80).collect::<String>()).filter(|a| !a.is_empty());
        let question = args["question"].as_str().map(|q| q.trim().chars().take(300).collect::<String>()).filter(|q| !q.is_empty());
        let shared = self.shared.clone();
        let name_owned = name.to_string();
        let (base, key, model, proxy) = {
            let s = self.shared.settings.lock().unwrap();
            (s.config.base_url.clone(), s.api_key.clone(), s.config.model.clone(), s.config.proxy.clone())
        };
        let job = move || -> Result<String, String> {
            match name_owned.as_str() {
                "screenshot" => shared.desk.screenshot(app.as_deref()),
                "look" => shared.desk.look(app.as_deref()),
                _ => {
                    let shot = shared.desk.capture(app.as_deref())?;
                    let q = question.unwrap_or_else(|| "屏幕上现在是什么？用一两句话说说。".into());
                    let messages = json!([{"role": "user", "content": [
                        {"type": "text", "text": q},
                        {"type": "image_url", "image_url": {"url": shot.data_url, "detail": "high"}}
                    ]}]);
                    let r = llm::chat(&llm::Request {
                        base_url: &base,
                        api_key: &key,
                        model: &model,
                        proxy: &proxy,
                        messages: &messages,
                        tools: None,
                        temperature: 0.3,
                        max_tokens: 700,
                        thinking: Some(json!({"type": "disabled"})),
                    })
                    .map_err(|e| e.message)?;
                    shared.settings.lock().unwrap().spend(r.total_tokens);
                    let t: String = r.content.trim().chars().take(1200).collect();
                    Ok(if t.is_empty() { "（看图没说出什么）".into() } else { t })
                }
            }
        };
        match self.pump(job, false) {
            Some(Ok(t)) => {
                self.shared.store.lock().unwrap().append("acted", channel, "", name);
                let t: String = t.chars().take(2000).collect();
                if t.is_empty() {
                    "做完了，但没什么可说的".into()
                } else {
                    t
                }
            }
            Some(Err(e)) => format!("没做成：{e}"),
            None => "没做成".into(),
        }
    }
}
