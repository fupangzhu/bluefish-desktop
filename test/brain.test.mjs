import test from 'node:test';
import assert from 'node:assert/strict';
import {splitReply,typingDelay,cleanReply} from '../src/brain/speak.mjs';
import {Debounce} from '../src/brain/debounce.mjs';
import {Brain} from '../src/brain/brain.mjs';
import {EventStore} from '../src/brain/events.mjs';
import {plannerTools,situation,ACTIONS} from '../src/brain/prompts.mjs';
import {chat,readChoice,parseArgs} from '../src/brain/llm.mjs';

// ---- speak -------------------------------------------------------------------------------------
test('replies are cleaned of markdown and stage directions',()=>{
  assert.equal(cleanReply('**嗯**（歪头）我在呢'),'嗯我在呢');
  assert.equal(cleanReply('“好呀”'),'好呀');
});
test('replies split into at most three lines and short pieces fold back',()=>{
  assert.deepEqual(splitReply('嗯。今天好困啊！你呢？'),['嗯。','今天好困啊！你呢？']);
  assert.equal(splitReply('一。二二二二。三三三三。四四四四。五五五五。').length,3);
  assert.deepEqual(splitReply('第一行\n第二行很长很长'),['第一行','第二行很长很长']);
  assert.deepEqual(splitReply(''),[]);
});
test('typing delay grows with length and stays within bounds',()=>{
  assert.ok(typingDelay('嗯')>=.6);
  assert.ok(typingDelay('今天天气真好')>typingDelay('嗯嗯'));
  assert.equal(typingDelay('很'.repeat(100)),4);
});

// ---- debounce ----------------------------------------------------------------------------------
test('debounce waits for quiet, holds while typing, and never exceeds the batch limit',()=>{
  const d=new Debounce();
  assert.equal(d.push(0),2);
  assert.equal(d.due(1.9),false);
  d.push(1.5);assert.equal(d.deadline,3.5);
  d.typing(3);assert.equal(d.deadline,6);
  d.typing(5.5);assert.equal(d.deadline,8);
  assert.equal(d.due(8),true);assert.equal(d.pending,false);
  // A message soon after the last batch counts as an active conversation: wait longer.
  assert.equal(d.push(10),15);
});

// ---- prompts -----------------------------------------------------------------------------------
test('planner exposes the chat and desktop tools with the gesture list',()=>{
  const tools=plannerTools().map(t=>t.function.name);
  assert.deepEqual(tools,['reply','act','wait','screenshot','look','see','stop']);
  const act=plannerTools()[1].function.parameters.properties.action;
  assert.deepEqual(act.enum,Object.keys(ACTIONS));
  const text=situation({now:Date.UTC(2026,10,6,12),channel:'desktop',history:[],fresh:[{type:'heard',ts:Date.UTC(2026,10,6,12),text:'在吗'}]});
  assert.match(text,/【新消息】\n主人 \d\d:\d\d：在吗/);
});
test('a mixed conversation says which channel each line came from',()=>{
  const mixed=situation({now:Date.UTC(2026,10,6,12),channel:'desktop',history:[{type:'said',ts:Date.UTC(2026,10,6,11),text:'微信里的',channel:'weixin'}],fresh:[{type:'heard',ts:Date.UTC(2026,10,6,12),text:'在吗',channel:'desktop'}]});
  assert.match(mixed,/你（微信） \d\d:\d\d：微信里的/);
  assert.match(mixed,/主人 \d\d:\d\d：在吗/);
  const single=situation({now:Date.UTC(2026,10,6,12),channel:'desktop',history:[],fresh:[{type:'heard',ts:Date.UTC(2026,10,6,12),text:'在吗',channel:'desktop'}]});
  assert.doesNotMatch(single,/（微信）/);
});
test('model tool-call arguments are parsed defensively',()=>{
  assert.deepEqual(parseArgs('{"a":1}'),{a:1});
  assert.deepEqual(parseArgs('not json'),{});
  const r=readChoice({choices:[{message:{content:null,tool_calls:[{id:'x',function:{name:'act',arguments:'{"action":"nod"}'}}]}}]});
  assert.equal(r.content,'');assert.equal(r.toolCalls[0].name,'act');assert.equal(r.toolCalls[0].args.action,'nod');
});
test('chat client reports missing config without calling the network',async()=>{
  let called=false;const fetchImpl=async()=>{called=true;};
  await assert.rejects(chat({baseUrl:'https://x',apiKey:'',model:'m',messages:[],fetchImpl}),e=>e.kind==='config');
  assert.equal(called,false);
});
test('chat client sends tools and reads a tool call',async()=>{
  let sent;
  const fetchImpl=async(url,init)=>{sent={url,body:JSON.parse(init.body),auth:init.headers.Authorization};return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'1',function:{name:'stop',arguments:'{}'}}]}}],usage:{total_tokens:42}}),{status:200});};
  const r=await chat({baseUrl:'https://api.example.com/',apiKey:'k',model:'m',messages:[{role:'user',content:'hi'}],tools:plannerTools(),fetchImpl});
  assert.equal(sent.url,'https://api.example.com/chat/completions');assert.equal(sent.auth,'Bearer k');
  assert.equal(sent.body.tool_choice,'auto');assert.equal(r.toolCalls[0].name,'stop');assert.equal(r.usage.total_tokens,42);
});

// ---- brain -------------------------------------------------------------------------------------
function fakeClock(){
  const c={t:Date.UTC(2026,10,6,12),slept:0,
    now:()=>c.t,
    setTimeout:(f,ms)=>setTimeout(()=>{c.t+=ms;f();},0),clearTimeout:id=>clearTimeout(id),
    sleep:async(ms,signal)=>{await new Promise(r=>setImmediate(r));if(signal?.aborted)return false;c.t+=ms;c.slept+=ms;return true;}};
  return c;
}
const call=(name,args={})=>({id:name+Math.random(),name,args});
function rig(script){
  const clock=fakeClock(),store=new EventStore(null,{now:clock.now}),log=[],requests=[];
  const out={say:(t,ch)=>log.push(['say',t,ch]),act:(a,ch)=>log.push(['act',a,ch]),typing:()=>{},notice:(t)=>log.push(['notice',t]),state:()=>{}};
  const llm=async(req)=>{requests.push(req);const next=script.shift();if(!next)return {content:'',toolCalls:[]};return typeof next==='function'?next(req):next;};
  const brain=new Brain({llm,store,out,clock,persona:()=>'测试人设'});
  return {brain,store,log,requests,clock};
}

test('a message is answered with a planned reply split into paced lines and recorded',async()=>{
  const {brain,store,log,requests}=rig([
    {content:'',toolCalls:[call('act',{action:'nod'}),call('reply',{reference:'打招呼'})]},
    {content:'在呢。找我干嘛？',toolCalls:[]}
  ]);
  brain.receive('在吗');
  await brain.settle();
  assert.deepEqual(log,[['act','nod','desktop'],['say','在呢。','desktop'],['say','找我干嘛？','desktop']]);
  assert.equal(requests.length,2,'one planner call, one replyer call; no extra round after speaking');
  assert.match(requests[0].messages[1].content,/【新消息】\n主人 .*在吗/);
  assert.equal(requests[1].messages[0].content.startsWith('测试人设'),true);
  assert.deepEqual(store.recent(10).map(e=>e.type),['heard','acted','said','said']);
});
test('she may choose to stay silent',async()=>{
  const {brain,log}=rig([{content:'',toolCalls:[call('stop')]}]);
  brain.receive('嗯');await brain.settle();
  assert.deepEqual(log,[]);
});
test('a burst of messages becomes one turn',async()=>{
  const {brain,requests}=rig([{content:'',toolCalls:[]}]);
  brain.receive('我跟你说');brain.receive('今天');brain.receive('好累');
  await brain.settle();
  assert.equal(requests.length,1);
  assert.match(requests[0].messages[1].content,/我跟你说[\s\S]*今天[\s\S]*好累/);
});
test('an unknown gesture is refused honestly',async()=>{
  const {brain,requests,log}=rig([{content:'',toolCalls:[call('act',{action:'backflip'})]},{content:'',toolCalls:[]}]);
  brain.receive('翻个跟头');await brain.settle();
  assert.deepEqual(log,[]);
  const tool=requests[1].messages.find(m=>m.role==='tool');
  assert.match(tool.content,/做不了/);
});
test('a new message during thinking makes her think again with it',async()=>{
  let brainRef;
  const {brain,requests}=rig([
    ()=>{brainRef.receive('等等，还有');return {content:'',toolCalls:[call('stop')]};},
    {content:'',toolCalls:[call('stop')]}
  ]);brainRef=brain;
  brain.receive('第一句');await brain.settle();
  assert.equal(requests.length,2);
  assert.match(requests[1].messages[1].content,/第一句[\s\S]*等等，还有/);
});
test('rounds are capped',async()=>{
  const waits=Array.from({length:10},()=>({content:'',toolCalls:[call('wait',{seconds:5})]}));
  const {brain,requests}=rig(waits);
  brain.receive('hi');const r=await brain.turn();await brain.settle();
  assert.ok(requests.length<=4);
});
test('model errors become a visible notice and a head shake',async()=>{
  const {brain,log}=rig([()=>{const e=new Error('还没有填 API Key');e.kind='config';throw e;}]);
  brain.receive('在吗');await brain.settle();
  assert.deepEqual(log[0],['act','shakehead','desktop']);
  assert.match(log[1][1],/API Key/);
});
test('replies go back to the channel the message came from',async()=>{
  const {brain,log}=rig([{content:'',toolCalls:[call('reply',{reference:'x'})]},{content:'好的。',toolCalls:[]}]);
  brain.receive('hello','weixin');await brain.settle();
  assert.deepEqual(log,[['say','好的。','weixin']]);
});
test('a message from another channel waits for the running turn and is answered on its own channel',async()=>{
  let brainRef;
  const {brain,log}=rig([
    ()=>{brainRef.receive('微信那边','weixin');return {content:'',toolCalls:[call('reply',{reference:'桌面'})]};},
    {content:'桌面的回复。',toolCalls:[]},
    {content:'',toolCalls:[call('reply',{reference:'微信'})]},
    {content:'微信的回复。',toolCalls:[]}
  ]);brainRef=brain;
  brain.receive('桌面这边');await brain.settle();await brain.settle();
  assert.deepEqual(log,[['say','桌面的回复。','desktop'],['say','微信的回复。','weixin']]);
});
test('a desktop tool runs, is recorded, and reports its result back to her',async()=>{
  const {brain,requests,store}=rig([
    {content:'',toolCalls:[call('screenshot',{app:'chrome.exe'})]},
    {content:'',toolCalls:[call('reply',{reference:'说文件路径'})]},
    {content:'截好了。',toolCalls:[]}
  ]);
  const seen=[];
  brain.tools={screenshot:async args=>{seen.push(args);return {text:'截图好了（chrome.exe），存在 C:/shots/a.png'};}};
  brain.receive('截个图');await brain.settle();
  assert.deepEqual(seen,[{app:'chrome.exe'}],'the app argument is passed through, nothing else');
  const tool=requests[1].messages.find(m=>m.role==='tool');
  assert.match(tool.content,/C:\/shots\/a\.png/);
  assert.ok(store.recent(10).some(e=>e.type==='acted'&&e.action==='screenshot'));
});
test('a missing tool or a failing one is reported honestly',async()=>{
  const {brain,requests}=rig([
    {content:'',toolCalls:[call('look',{})]},
    {content:'',toolCalls:[call('screenshot',{})]},
    {content:'',toolCalls:[call('stop')]}
  ]);
  brain.tools={look:async()=>{throw Error('agent-desktop 超时');}};
  brain.receive('看看屏幕');await brain.settle();
  const tools=requests[1].messages.filter(m=>m.role==='tool').map(m=>m.content);
  assert.match(tools[0],/没做成：agent-desktop 超时/);
  assert.match(tools[1],/没有这个能力/);
});
test('see passes the question and the target app through, then reports the answer',async()=>{
  const {brain,requests}=rig([
    {content:'',toolCalls:[call('see',{question:'这个报错是什么',app:'chrome.exe'})]},
    {content:'',toolCalls:[call('reply',{reference:'解释报错'})]},
    {content:'它说找不到文件。',toolCalls:[]}
  ]);
  const seen=[];
  brain.tools={see:async args=>{seen.push(args);return {text:'截图里是一个 FileNotFound 报错'};}};
  brain.receive('看下这个报错');await brain.settle();
  assert.deepEqual(seen,[{app:'chrome.exe',question:'这个报错是什么'}]);
  const tool=requests[1].messages.find(m=>m.role==='tool');
  assert.match(tool.content,/FileNotFound/);
});
test('an exhausted daily budget stops the model from being called',async()=>{
  const {brain,requests,log,store}=rig([]);
  brain.budget={exhausted:()=>true};
  brain.receive('在吗');await brain.settle();
  assert.equal(requests.length,0);assert.equal(log[0][1],'shakehead');
});
