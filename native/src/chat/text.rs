//! src/brain/speak.mjs, debounce.mjs and prompts.mjs: splitting a reply into chat lines, typing
//! pace, waiting for the owner to finish, and the planner/replyer prompt text.
use super::events::Event;
use serde_json::{json, Value};

// ---- speak.mjs ---------------------------------------------------------------------------------
pub const MAX_LINES: usize = 3;
pub const MIN_LINE: usize = 4;

fn is_end(c: char) -> bool {
    matches!(c, '。' | '！' | '？' | '!' | '?' | '…' | '~' | '～')
}

/// Strip what a chat line should never carry: markdown, stage directions, wrapping quotes.
pub fn clean_reply(text: &str) -> String {
    // ```fenced``` blocks
    let mut s = String::new();
    let mut rest = text;
    while let Some(i) = rest.find("```") {
        s.push_str(&rest[..i]);
        match rest[i + 3..].find("```") {
            Some(j) => rest = &rest[i + 3 + j + 3..],
            None => {
                rest = &rest[i..];
                break;
            }
        }
    }
    s.push_str(rest);
    let s: String = s.chars().filter(|c| !matches!(c, '*' | '_' | '#' | '>' | '`')).collect();
    // (stage directions) of up to 24 characters, either bracket style.
    let chars: Vec<char> = s.chars().collect();
    let mut out: Vec<char> = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if matches!(chars[i], '（' | '(') {
            let mut j = i + 1;
            while j < chars.len() && j - i - 1 <= 24 && !matches!(chars[j], '（' | '）' | '(' | ')') {
                j += 1;
            }
            if j < chars.len() && j - i - 1 <= 24 && matches!(chars[j], '）' | ')') {
                i = j + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    let s: String = out.into_iter().collect();
    // Wrapping quotes.
    let s = s.trim_start_matches(|c: char| c.is_whitespace()).trim_start_matches(['"', '“', '「', '『']);
    let s = s.trim_end_matches(|c: char| c.is_whitespace()).trim_end_matches(['"', '”', '」', '』']);
    // Runs of spaces/tabs to one space.
    let mut res = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if c == ' ' || c == '\t' {
            if !space {
                res.push(' ');
            }
            space = true;
        } else {
            res.push(c);
            space = false;
        }
    }
    res.trim().to_string()
}

pub fn split_reply(text: &str) -> Vec<String> {
    let clean = clean_reply(text);
    if clean.is_empty() {
        return Vec::new();
    }
    let mut parts: Vec<String> = Vec::new();
    let mut buf = String::new();
    let chars: Vec<char> = clean.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\n' {
            while i < chars.len() && chars[i] == '\n' {
                i += 1;
            }
            if !buf.trim().is_empty() {
                parts.push(buf.trim().to_string());
            }
            buf.clear();
            continue;
        }
        if is_end(c) {
            while i < chars.len() && is_end(chars[i]) {
                buf.push(chars[i]);
                i += 1;
            }
            parts.push(buf.trim().to_string());
            buf.clear();
            continue;
        }
        buf.push(c);
        i += 1;
    }
    if !buf.trim().is_empty() {
        parts.push(buf.trim().to_string());
    }
    let mut merged: Vec<String> = Vec::new();
    for p in parts {
        if !merged.is_empty() && p.chars().count() < MIN_LINE {
            merged.last_mut().unwrap().push_str(&p);
        } else {
            merged.push(p);
        }
    }
    while merged.len() > MAX_LINES {
        let tail = merged.pop().unwrap();
        merged.last_mut().unwrap().push_str(&tail);
    }
    merged.retain(|l| !l.is_empty());
    merged
}

/// Seconds of "typing" before a line appears.
pub fn typing_delay(line: &str) -> f64 {
    let (mut cjk, mut latin) = (0.0f64, 0.0f64);
    for c in line.chars() {
        if ('\u{3400}'..='\u{9fff}').contains(&c) {
            cjk += 1.0;
        } else if !c.is_whitespace() {
            latin += 1.0;
        }
    }
    (cjk * 0.25 + latin * 0.12 + 0.3).clamp(0.6, 4.0)
}

// ---- debounce.mjs ------------------------------------------------------------------------------
pub struct Debounce {
    first: Option<f64>,
    pub deadline: Option<f64>,
    last_arrival: Option<f64>,
}
const QUIET: f64 = 2.0;
const ACTIVE: f64 = 5.0;
const BATCH_LIMIT: f64 = 8.0;
const ACTIVE_GAP: f64 = 30.0;
const TYPING_GRACE: f64 = 3.0;
impl Default for Debounce {
    fn default() -> Self {
        Debounce { first: None, deadline: None, last_arrival: None }
    }
}
impl Debounce {
    pub fn reset(&mut self) {
        self.first = None;
        self.deadline = None;
    }
    pub fn pending(&self) -> bool {
        self.first.is_some()
    }
    pub fn push(&mut self, now: f64) -> f64 {
        let active = self.last_arrival.is_some_and(|l| now - l <= ACTIVE_GAP);
        let first = *self.first.get_or_insert(now);
        self.last_arrival = Some(now);
        let wait = if self.deadline.is_none() { if active { ACTIVE } else { QUIET } } else { QUIET };
        let d = (first + BATCH_LIMIT).min(now + wait);
        self.deadline = Some(d);
        d
    }
    pub fn typing(&mut self, now: f64) -> Option<f64> {
        let first = self.first?;
        let d = (first + BATCH_LIMIT).min(self.deadline.unwrap_or(now).max(now + TYPING_GRACE));
        self.deadline = Some(d);
        Some(d)
    }
    pub fn due(&mut self, now: f64) -> bool {
        match (self.first, self.deadline) {
            (Some(_), Some(d)) if now >= d => {
                self.reset();
                true
            }
            _ => false,
        }
    }
}

// ---- prompts.mjs -------------------------------------------------------------------------------
pub const DEFAULT_PERSONA: &str = "你叫小鱼，全名\"蓝色肥鱼\"，住在主人的电脑桌面上，平时趴在任务栏上，头顶有一根呆毛，还有一对会动的耳朵。\n性格：有点懒，有点嘴硬，但很黏主人；被捉弄会小小地生气，很快又好了。\n说话：口语、短句，像在发消息；偶尔用\"嗯\"\"诶\"这类语气词；不用敬语，不说自己是 AI 或助手。";

pub const ACTIONS: [(&str, &str); 7] = [
    ("nod", "点头"),
    ("shakehead", "摇头"),
    ("happy", "开心地晃一晃"),
    ("wink", "眨一只眼"),
    ("blink", "眨眨眼"),
    ("dip", "害羞地往下躲一下"),
    ("ear", "抖一下耳朵"),
];
pub fn action_name(key: &str) -> Option<&'static str> {
    ACTIONS.iter().find(|a| a.0 == key).map(|a| a.1)
}
pub fn channel_name(c: &str) -> &str {
    match c {
        "desktop" => "桌面",
        "weixin" => "微信",
        "qq" => "QQ",
        other => other,
    }
}

pub fn planner_tools() -> Value {
    let enum_keys: Vec<&str> = ACTIONS.iter().map(|a| a.0).collect();
    let desc: Vec<String> = ACTIONS.iter().map(|a| format!("{}={}", a.0, a.1)).collect();
    json!([
        {"type":"function","function":{"name":"reply","description":"对主人说话。只有调用它，主人才能看到你的话。","parameters":{"type":"object","properties":{
            "reference":{"type":"string","description":"这次想回应什么、往哪个方向说（写思路，不写台词本身）"},
            "tone":{"type":"string","description":"可选，语气，比如：撒娇、嘴硬、困、开心、认真"}
        },"required":["reference"]}}},
        {"type":"function","function":{"name":"act","description":"只做一个动作，不说话。","parameters":{"type":"object","properties":{
            "action":{"type":"string","enum":enum_keys,"description":desc.join("，")}
        },"required":["action"]}}},
        {"type":"function","function":{"name":"wait","description":"等一会儿再判断，比如主人好像还没说完。期间有新消息会马上叫醒你。","parameters":{"type":"object","properties":{
            "seconds":{"type":"number","description":"等几秒，5 到 120"}
        },"required":["seconds"]}}},
        {"type":"function","function":{"name":"screenshot","description":"给主人截一张屏幕。不传 app 截整个屏幕，传 app 就只截那个应用的窗口（例如 chrome.exe）。截完会自动放进剪贴板，并把文件路径告诉主人。","parameters":{"type":"object","properties":{
            "app":{"type":"string","description":"可选，应用名，比如 chrome.exe、notepad.exe；留空表示整个屏幕"}
        }}}},
        {"type":"function","function":{"name":"look","description":"看一眼某个窗口现在显示什么（只读，不会点任何东西）。不传 app 就看当前前台窗口。","parameters":{"type":"object","properties":{
            "app":{"type":"string","description":"可选，应用名；留空表示当前前台窗口"}
        }}}},
        {"type":"function","function":{"name":"see","description":"看屏幕并回答一个问题——会真的把截图交给视觉模型看懂，比如\"这个报错是什么意思\"\"图里这个人穿什么颜色\"。比 look 更接近\"亲眼看见\"，但更慢、更花钱。","parameters":{"type":"object","properties":{
            "question":{"type":"string","description":"你想从这张截图里知道什么，问得具体一点"},
            "app":{"type":"string","description":"可选，只看某个应用的窗口；留空表示整个屏幕"}
        },"required":["question"]}}},
        {"type":"function","function":{"name":"stop","description":"结束这一轮，不再做任何事。","parameters":{"type":"object","properties":{}}}}
    ])
}

fn persona_or_default(p: &str) -> &str {
    if p.trim().is_empty() {
        DEFAULT_PERSONA
    } else {
        p
    }
}
pub fn planner_system(persona: &str) -> String {
    format!(
        "{}\n\n你现在要决定下一步做什么。能做的事只有调用工具：\n- reply：对主人说话。只有调用它，主人才看得到你的话。reference 里写想回应什么、往哪个方向说，不写台词。\n- act：只做一个动作，不说话。\n- wait：等一会儿再判断。\n- screenshot：截屏给主人看（可指定应用），截完自动进剪贴板。\n- look：看一眼窗口现在显示什么（只读）。读不出内容时如实告诉主人，可以改用截图。\n- see：看屏幕并回答一个问题（真的用视觉模型看图）。主人问\"屏幕上这是什么\"\"这个报错怎么读\"时用它。\n- stop：结束这一轮。不调用任何工具也等于结束。\n不是每句话都要回。主人只是\"嗯\"\"哦\"，或者话已经说完了，可以只做个动作，或者什么都不做。\n一轮里最多说一次话；说话的同时可以配一个动作。\n主人让你截图、看屏幕时，先动手做完，再用 reply 把结果（比如文件路径）说清楚——别只说\"我去看看\"就完事。",
        persona_or_default(persona)
    )
}
pub fn replyer_system(persona: &str) -> String {
    format!(
        "{}\n\n现在轮到你开口。读一下聊天记录，接着话题说。\n要求：口语化，像发消息；一到三句，通常很短；不要用括号写动作，不要 markdown，不要列点；不要重复自己刚说过的话。\n直接输出你要说的话，别的什么都不要。",
        persona_or_default(persona)
    )
}

/// Local wall-clock parts of a unix time in ms: (year, month, day, weekday 0=Sunday, hour, minute).
pub fn local(ms: f64) -> (i32, u32, u32, u32, u32, u32) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Foundation::{FILETIME, SYSTEMTIME};
        use windows::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};
        let t = (ms.max(0.0) as u64) * 10_000 + 116_444_736_000_000_000;
        let ft = FILETIME { dwLowDateTime: t as u32, dwHighDateTime: (t >> 32) as u32 };
        let mut utc = SYSTEMTIME::default();
        let mut loc = SYSTEMTIME::default();
        if FileTimeToSystemTime(&ft, &mut utc).is_ok() && SystemTimeToTzSpecificLocalTime(None, &utc, &mut loc).is_ok() {
            return (loc.wYear as i32, loc.wMonth as u32, loc.wDay as u32, loc.wDayOfWeek as u32, loc.wHour as u32, loc.wMinute as u32);
        }
    }
    // Fallback: UTC from the civil-from-days algorithm.
    let secs = (ms / 1000.0).floor() as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (yoe + era * 400 + if m <= 2 { 1 } else { 0 }) as i32;
    let wd = ((days + 4).rem_euclid(7)) as u32;
    (y, m, d, wd, (rem / 3600) as u32, ((rem % 3600) / 60) as u32)
}
pub fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}
pub fn clock_text(ms: f64) -> String {
    let (y, mo, d, wd, h, mi) = local(ms);
    let week = ['日', '一', '二', '三', '四', '五', '六'][wd as usize % 7];
    format!("{y}-{mo:02}-{d:02} 周{week} {h:02}:{mi:02}")
}
fn hm(ms: f64) -> String {
    let (_, _, _, _, h, mi) = local(ms);
    format!("{h:02}:{mi:02}")
}

/// With `tag`, lines from a channel other than the desktop say so.
pub fn transcript(events: &[Event], tag: bool) -> String {
    let wher = |e: &Event| {
        if tag && e.channel != "desktop" && !e.channel.is_empty() {
            format!("（{}）", channel_name(&e.channel))
        } else {
            String::new()
        }
    };
    events
        .iter()
        .filter_map(|e| match e.kind.as_str() {
            "heard" => Some(format!("主人{} {}：{}", wher(e), hm(e.ts), e.text)),
            "said" => Some(format!("你{} {}：{}", wher(e), hm(e.ts), e.text)),
            "acted" => Some(format!("你 {}：（{}）", hm(e.ts), action_name(&e.action).unwrap_or(&e.action))),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}
pub fn situation(now: f64, channel: &str, history: &[Event], fresh: &[Event]) -> String {
    let mut lines = vec![format!("【现在】{}", clock_text(now)), format!("【渠道】{}", channel_name(channel))];
    let chans: std::collections::HashSet<&str> =
        history.iter().chain(fresh).map(|e| if e.channel.is_empty() { "desktop" } else { e.channel.as_str() }).collect();
    let tag = chans.len() > 1;
    if history.is_empty() {
        lines.push("【之前的聊天】（没有）".into());
    } else {
        lines.push("【之前的聊天】".into());
        lines.push(transcript(history, tag));
    }
    if !fresh.is_empty() {
        lines.push("【新消息】".into());
        lines.push(transcript(fresh, tag));
    }
    lines.join("\n")
}
pub fn replyer_user(now: f64, history: &[Event], reference: &str, tone: &str) -> String {
    let t = transcript(history, false);
    let mut v = vec![
        format!("【现在】{}", clock_text(now)),
        "【聊天记录】".into(),
        if t.is_empty() { "（没有）".into() } else { t },
        format!("【你想说的方向】{reference}"),
    ];
    if !tone.is_empty() {
        v.push(format!("【语气】{tone}"));
    }
    v.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleaning_and_splitting() {
        assert_eq!(clean_reply("**嗯**（歪头）我在呢"), "嗯我在呢");
        assert_eq!(clean_reply("“好呀”"), "好呀");
        assert_eq!(split_reply("嗯。今天好困啊！你呢？"), vec!["嗯。", "今天好困啊！你呢？"]);
        assert_eq!(split_reply("一。二二二二。三三三三。四四四四。五五五五。").len(), 3);
        assert_eq!(split_reply("第一行\n第二行很长很长"), vec!["第一行", "第二行很长很长"]);
        assert!(split_reply("").is_empty());
    }
    #[test]
    fn typing_pace() {
        assert!(typing_delay("嗯") >= 0.6);
        assert!(typing_delay("今天天气真好") > typing_delay("嗯嗯"));
        assert_eq!(typing_delay(&"很".repeat(100)), 4.0);
    }
    #[test]
    fn debounce() {
        let mut d = Debounce::default();
        assert_eq!(d.push(0.0), 2.0);
        assert!(!d.due(1.9));
        d.push(1.5);
        assert_eq!(d.deadline, Some(3.5));
        d.typing(3.0);
        assert_eq!(d.deadline, Some(6.0));
        d.typing(5.5);
        assert_eq!(d.deadline, Some(8.0));
        assert!(d.due(8.0));
        assert!(!d.pending());
        assert_eq!(d.push(10.0), 15.0);
    }
    #[test]
    fn tools_and_situation() {
        let names: Vec<String> = planner_tools().as_array().unwrap().iter().map(|t| t["function"]["name"].as_str().unwrap().to_string()).collect();
        assert_eq!(names, ["reply", "act", "wait", "screenshot", "look", "see", "stop"]);
        let e = |kind: &str, text: &str, ch: &str| Event { kind: kind.into(), text: text.into(), channel: ch.into(), ..Event::default() };
        let mixed = situation(0.0, "desktop", &[e("said", "微信里的", "weixin")], &[e("heard", "在吗", "desktop")]);
        assert!(mixed.contains("你（微信） "), "{mixed}");
        assert!(mixed.contains("【新消息】\n主人 "), "{mixed}");
        let single = situation(0.0, "desktop", &[], &[e("heard", "在吗", "desktop")]);
        assert!(!single.contains("（微信）"));
    }
}
