import {headContact} from './attention.mjs';
import {Motion,fromPromptSoulSegment} from './motion.mjs';
import {Renderer} from './renderer.mjs';
import {hydrate,icons} from './icons.mjs';
import {TouchInput} from './touch.mjs';
hydrate();
const $=s=>document.querySelector(s);
const ctl=window.petControl||null;
const canvas=$('#avatar'),stage=$('#stage'),statusDot=$('#status'),statusWrap=$('#statusWrap');
const motion=new Motion();motion.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const AXES=['yaw','pitch','roll'],MODES=['follow','idle','reduced','docked'];
const local={size:240,docked:true,follow:true,idle:true,reduced:motion.reduced,pose:{yaw:0,pitch:0,roll:0}};
let renderer=null,rig=null;

/* Status is a single dot; the text lives in the tooltip. */
function setStatus(state,text){statusDot.dataset.state=state;statusWrap.title=text;statusWrap.setAttribute('aria-label',text);}
setStatus('working','正在准备角色');

/* Slider helpers */
const active=new Set();
function progress(el){el.style.setProperty('--progress',((el.value-el.min)/(el.max-el.min)*100)+'%');}
function track(el){el.addEventListener('pointerdown',()=>active.add(el.id));for(const ev of ['pointerup','pointercancel','blur'])el.addEventListener(ev,()=>active.delete(el.id));}
const fmt=v=>(Math.abs(v)<.05?0:v).toFixed(1)+'°';

/* Render state into controls + local preview. Never sends anything back. */
function apply(s){
  if(!s)return;
  Object.assign(local,s);if(s.pose)local.pose={...s.pose};
  if(Number.isFinite(s.size)&&!active.has('size')){$('#size').value=s.size;progress($('#size'));$('#sizeValue').textContent=Math.round(s.size);}
  for(const k of MODES)if(k in s&&k!=='docked'){motion[k]=!!s[k];}
  for(const k of MODES)if(k in s)$('#'+k).setAttribute('aria-pressed',String(!!s[k]));
  if(s.pose){
    for(const k of AXES){if(active.has(k))continue;const v=+s.pose[k]||0;motion.pose[k]=v;$('#'+k).value=v;progress($('#'+k));$('#'+k+'Value').textContent=fmt(v);}
  }
}
/* User-initiated change: apply locally, then tell the desktop. */
function send(patch){apply(patch);ctl?.set(patch);}

if(ctl){$('#sizeCard').hidden=false;$('#docked').hidden=false;}
for(const el of document.querySelectorAll('input.range'))progress(el);

/* Size */
{
  const el=$('#size');let pending=null,raf=0;track(el);
  el.addEventListener('input',()=>{progress(el);$('#sizeValue').textContent=el.value;pending=+el.value;if(!raf)raf=requestAnimationFrame(()=>{raf=0;if(pending!=null){const v=pending;pending=null;local.size=v;ctl?.set({size:v});}});});
}

/* Pose */
{
  let raf=0;
  const flush=()=>{raf=0;ctl?.set({follow:false,pose:{...local.pose}});};
  for(const k of AXES){
    const el=$('#'+k);track(el);
    const commit=v=>{local.pose={...local.pose,[k]:v};motion.pose[k]=v;$('#'+k+'Value').textContent=fmt(v);
      if(local.follow){local.follow=false;motion.follow=false;$('#follow').setAttribute('aria-pressed','false');}
      if(ctl&&!raf)raf=requestAnimationFrame(flush);};
    el.addEventListener('input',()=>{progress(el);commit(+el.value);});
    $('#'+k+'Value').addEventListener('dblclick',()=>{el.value=0;progress(el);commit(0);});
  }
}

/* Actions */
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{motion.gesture(b.dataset.action);ctl?.action(b.dataset.action);}));
$('#reset').addEventListener('click',()=>{
  endTouch();
  motion.reset();motion.follow=true;
  apply({follow:true,pose:{yaw:0,pitch:0,roll:0}});
  ctl?.action('reset');
});

/* Modes */
for(const k of MODES)$('#'+k).addEventListener('click',()=>send({[k]:$('#'+k).getAttribute('aria-pressed')!=='true'}));

/* Stage background */
$('#background').addEventListener('click',()=>{
  const light=stage.classList.toggle('light');
  $('#background span').innerHTML=icons[light?'moon':'sun'];
  const text=light?'切换深色背景':'切换浅色背景';$('#background').title=text;$('#background').setAttribute('aria-label',text);
});

/* Advanced */
$('#advToggle').addEventListener('click',()=>{
  const open=$('#advToggle').getAttribute('aria-expanded')!=='true';
  $('#advToggle').setAttribute('aria-expanded',String(open));$('#advBody').hidden=!open;$('#adv').dataset.open=open;
  const text=open?'收起高级选项':'展开高级选项';$('#advToggle').title=text;$('#advToggle').setAttribute('aria-label',text);
  if(open)$('#rail').scrollTo({top:$('#rail').scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
});

/* Stage sizing: canvas is always a square that fits the stage. */
new ResizeObserver(()=>{const r=stage.getBoundingClientRect(),side=Math.max(120,Math.floor(Math.min(r.width,r.height)-24));const px=Math.min(side,640)+'px';canvas.style.width=canvas.style.height=px;const m=$('#masterCompare');if(m)m.style.width=m.style.height=px;}).observe(stage);

/* Preview gaze: only while the cursor is over the stage. */
let attentionPointer=null;
function gaze(x,y){attentionPointer={x,y};const r=canvas.getBoundingClientRect();motion.setGaze((x-r.left-r.width*.5)/(r.width*.7),(y-r.top-r.height*.6)/(r.height*.7));}
stage.addEventListener('pointermove',e=>gaze(e.clientX,e.clientY));
stage.addEventListener('pointerleave',()=>{attentionPointer=null;motion.setGaze(0,0);});
addEventListener('blur',()=>{attentionPointer=null;motion.setGaze(0,0);});
const touchInput=new TouchInput(motion.touch);
let touchPointer=null;
const canvasPoint=e=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0||touchPointer!==null||!renderer)return;
  const p=canvasPoint(e);if(!renderer.hitTest(p.x,p.y))return;
  touchPointer=e.pointerId;canvas.setPointerCapture(e.pointerId);
  const hit=renderer.pickHit(p.x,p.y),part=hit?.part;
  touchInput.begin(part,{x:e.clientX,y:e.clientY},canvas.clientWidth,hit);
  if(!part)motion.blink();canvas.style.cursor=part==='ahoge'?'grabbing':'';
});
canvas.addEventListener('pointermove',e=>{if(e.pointerId===touchPointer)touchInput.move({x:e.clientX,y:e.clientY});});
function endTouch(e){
  if(e?.pointerId!==undefined&&touchPointer!==null&&e.pointerId!==touchPointer)return;
  if(e?.type==='pointerup')touchInput.move({x:e.clientX,y:e.clientY});
  touchInput.end(e?.type!=='pointerup');touchPointer=null;canvas.style.cursor='';
}
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,endTouch);
addEventListener('blur',endTouch);

/* Motion JSON */
function importMotion(data){if(data.cues)window.bluefish.playPromptSoulSegment(data);else motion.playCue(data);setStatus('ok','动作已加入播放队列');}
const fail=error=>{setStatus('error',error.message||String(error));console.error(error);};
$('#uploadCue').addEventListener('click',()=>$('#cueFile').click());
$('#cueFile').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>100000)throw Error('文件超过 100KB');importMotion(JSON.parse(await file.text()));}catch(error){fail(error);}finally{e.target.value='';}});
$('#demoCue').addEventListener('click',async()=>{try{const r=await fetch('examples/promptsoul-segment.json');if(!r.ok)throw Error('示例文件加载失败');importMotion(await r.json());}catch(error){fail(error);}});

/* Debug interface */
let paused=false;
window.bluefish={motion,get renderer(){return renderer;},get rig(){return rig;},pause(v=true){paused=v;},render(patch={}){renderer?.render({...motion.current,...patch});},playPromptSoulSegment(segment,duration=3){for(const a of fromPromptSoulSegment(segment,duration))motion.playCue(a.cue,a.delay);}};

/* Initial state and live sync */
if(ctl){ctl.onState(apply);try{apply(await ctl.getState());}catch(error){fail(error);}}else apply(local);

try{
  const response=await fetch('assets/rig.json');if(!response.ok)throw Error('角色文件加载失败');rig=await response.json();
  renderer=await new Renderer(canvas,rig).init();setStatus('ok','本地运行中');
  const solo=$('#soloLayer');
  for(const layer of rig.layers){const opt=document.createElement('option');opt.value=layer.name;opt.textContent=layer.name+(layer.empty?'（空层）':'');solo.append(opt);}
  solo.addEventListener('change',()=>renderer.solo=solo.value||null);
  $('#showMaster').addEventListener('click',()=>{
    const existing=$('#masterCompare'),btn=$('#showMaster');
    if(existing){existing.remove();canvas.style.visibility='';btn.setAttribute('aria-pressed','false');return;}
    const image=new Image();image.id='masterCompare';image.src=rig.master;image.alt='固定坐标的完整母版';image.className='master-compare';
    image.style.width=canvas.style.width;image.style.height=canvas.style.height;stage.append(image);canvas.style.visibility='hidden';btn.setAttribute('aria-pressed','true');
  });
  let last=performance.now();
  function draw(now){if(!paused){const dt=Math.min(.1,(now-last)/1000),r=canvas.getBoundingClientRect(),p=attentionPointer;
    const x=p?p.x-r.left:NaN,y=p?p.y-r.top:NaN;
    motion.attention.update(dt,{now:now/1000,reduced:motion.reduced,x,y,size:r.width,near:!!p,overHead:!!p&&headContact(x,y,r.width),hx:(x/r.width-.5)/.3,hy:(y/r.height-.46)/.23,blocked:!!touchInput.active,poke:!!touchInput.active});
    motion.step(dt);renderer.render(motion.current);}last=now;requestAnimationFrame(draw);}
  requestAnimationFrame(draw);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();endTouch();paused=true;setStatus('error','显卡上下文已暂停');});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
}catch(error){fail(error);}
