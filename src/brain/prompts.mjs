// Prompt text and tool schemas for the planner and the replyer. Pure: no I/O.
export const DEFAULT_PERSONA=`你叫小鱼，全名"蓝色肥鱼"，住在主人的电脑桌面上，平时趴在任务栏上，头顶有一根呆毛，还有一对会动的耳朵。
性格：有点懒，有点嘴硬，但很黏主人；被捉弄会小小地生气，很快又好了。
说话：口语、短句，像在发消息；偶尔用"嗯""诶"这类语气词；不用敬语，不说自己是 AI 或助手。`;

// Gestures the pet can do on its own; keys are what the renderer understands.
export const ACTIONS={
  nod:'点头',
  shakehead:'摇头',
  happy:'开心地晃一晃',
  wink:'眨一只眼',
  blink:'眨眨眼',
  dip:'害羞地往下躲一下',
  ear:'抖一下耳朵'
};

export const CHANNEL_NAMES={desktop:'桌面',weixin:'微信',qq:'QQ'};

export function plannerTools(){
  return [
    {type:'function',function:{name:'reply',description:'对主人说话。只有调用它，主人才能看到你的话。',parameters:{type:'object',properties:{
      reference:{type:'string',description:'这次想回应什么、往哪个方向说（写思路，不写台词本身）'},
      tone:{type:'string',description:'可选，语气，比如：撒娇、嘴硬、困、开心、认真'}
    },required:['reference']}}},
    {type:'function',function:{name:'act',description:'只做一个动作，不说话。',parameters:{type:'object',properties:{
      action:{type:'string',enum:Object.keys(ACTIONS),description:Object.entries(ACTIONS).map(([k,v])=>`${k}=${v}`).join('，')}
    },required:['action']}}},
    {type:'function',function:{name:'wait',description:'等一会儿再判断，比如主人好像还没说完。期间有新消息会马上叫醒你。',parameters:{type:'object',properties:{
      seconds:{type:'number',description:'等几秒，5 到 120'}
    },required:['seconds']}}},
    {type:'function',function:{name:'stop',description:'结束这一轮，不再做任何事。',parameters:{type:'object',properties:{}}}}
  ];
}

export function plannerSystem(persona){
  return `${persona||DEFAULT_PERSONA}

你现在要决定下一步做什么。能做的事只有调用工具：
- reply：对主人说话。只有调用它，主人才看得到你的话。reference 里写想回应什么、往哪个方向说，不写台词。
- act：只做一个动作，不说话。
- wait：等一会儿再判断。
- stop：结束这一轮。不调用任何工具也等于结束。
不是每句话都要回。主人只是"嗯""哦"，或者话已经说完了，可以只做个动作，或者什么都不做。
一轮里最多说一次话；说话的同时可以配一个动作。`;
}

export function replyerSystem(persona){
  return `${persona||DEFAULT_PERSONA}

现在轮到你开口。读一下聊天记录，接着话题说。
要求：口语化，像发消息；一到三句，通常很短；不要用括号写动作，不要 markdown，不要列点；不要重复自己刚说过的话。
直接输出你要说的话，别的什么都不要。`;
}

const pad=n=>String(n).padStart(2,'0');
const WEEK='日一二三四五六';
export function clockText(ms){const d=new Date(ms);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} 周${WEEK[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;}
const hm=ms=>{const d=new Date(ms);return `${pad(d.getHours())}:${pad(d.getMinutes())}`;};

// events: [{type:'heard'|'said'|'acted', ts, text?, action?}]
export function transcript(events){
  return events.map(e=>e.type==='heard'?`主人 ${hm(e.ts)}：${e.text}`:e.type==='said'?`你 ${hm(e.ts)}：${e.text}`:e.type==='acted'?`你 ${hm(e.ts)}：（${ACTIONS[e.action]||e.action}）`:null).filter(Boolean).join('\n');
}

export function situation({now,channel='desktop',history=[],fresh=[]}){
  const lines=[`【现在】${clockText(now)}`,`【渠道】${CHANNEL_NAMES[channel]||channel}`];
  if(history.length)lines.push('【之前的聊天】',transcript(history));
  else lines.push('【之前的聊天】（没有）');
  if(fresh.length)lines.push('【新消息】',transcript(fresh));
  return lines.join('\n');
}

export function replyerUser({now,history=[],reference='',tone=''}){
  return [`【现在】${clockText(now)}`,'【聊天记录】',transcript(history)||'（没有）',`【你想说的方向】${reference}`,tone?`【语气】${tone}`:''].filter(Boolean).join('\n');
}
