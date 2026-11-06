import {Preview,TOW_GRIP} from './preview.mjs';
import {headContact} from './attention.mjs';
import {Motion,fromPromptSoulSegment} from './motion.mjs';
import {Renderer} from './renderer.mjs';
import {hydrate,icons} from './icons.mjs';
import {TouchInput} from './touch.mjs';
import {drawHands,drawHeadHands,headGestureHands,makeSkin,sampleSkin} from './hands.mjs';
hydrate();
const $=s=>document.querySelector(s);
const ctl=null;
const canvas=$('#avatar'),stage=$('#stage'),statusDot=$('#status'),statusWrap=$('#statusWrap');
const motion=new Motion();motion.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const preview=new Preview(motion);
const AXES=['yaw','pitch','roll'],MODES=['follow','idle','reduced'];
const local={size:460,docked:true,follow:true,idle:true,reduced:motion.reduced,pose:{yaw:0,pitch:0,roll:0}};
let renderer=null,rig=null,skin=makeSkin();
const gestureCanvas=document.createElement('canvas');gestureCanvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';stage.append(gestureCanvas);
const gestureCtx=gestureCanvas.getContext('2d');
// Duck, tow and wall previews stage the pet like the desktop: a Windows-style taskbar at the cut line
// (her hands rest on its top edge), the monitor bezel below it and, for the wall slump, beyond the screen edge.
const LEDGE_PREVIEWS=new Set(['bonk','dip','tow','slump_l','slump_r']),CUT=(1+(.73-.5)*1.76)/2;   // overlay CUT_ART_Y inside the head box
const REACH={'-1':.37,'1':.4};   // desktop/dock.cjs REACH: outermost point of the tilted head per side (x size)
const TASKBAR=.2;                // taskbar height (x size): 48 px under a 240 px pet
const taskbar=document.createElement('div'),bezel=document.createElement('div'),edge=document.createElement('div');
taskbar.className='preview-taskbar';bezel.className='preview-bezel';edge.className='preview-bezel preview-edge';
taskbar.innerHTML='<div class="tb-apps"><i class="tb-start"></i><i class="tb-search"></i><i></i><i></i><i></i><i></i></div><div class="tb-tray"><i></i><i></i><time></time></div>';
taskbar.hidden=bezel.hidden=edge.hidden=true;canvas.after(taskbar,bezel,edge);
const clock=taskbar.querySelector('time');let clockText='';
function drawGesture(){
 const cur=motion.current,size=canvas.clientWidth,slump=cur?.slump||0,side=cur?.slumpSide||0,H=canvas.clientHeight;
 // Same offsets as the docked desktop overlay: the duck sinks, the wall slump slides toward the edge and down,
 // and the tow preview carries the head along like the native window would.
 const tow=preview.active?preview.stageShift()*size/240:0,lean=side*slump*.13*size,dx=lean+tow,dy=((cur?.dip||0)+.05*slump)*size;
 canvas.style.translate=dx||dy?dx+'px '+dy+'px':'';
 const showLedge=preview.active&&LEDGE_PREVIEWS.has(preview.name),cutY=canvas.offsetTop+CUT*H,barH=Math.round(TASKBAR*size);
 taskbar.hidden=bezel.hidden=!showLedge;
 if(showLedge){
  taskbar.style.top=cutY+'px';taskbar.style.height=barH+'px';taskbar.style.setProperty('--bar',barH+'px');bezel.style.top=cutY+barH+'px';
  const now=new Date(),text=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+'\n'+now.toLocaleDateString('zh-CN');
  if(text!==clockText){clockText=text;clock.textContent=text;}
 }
 canvas.style.clipPath=showLedge?'inset(0 0 '+Math.max(0,H-(CUT*H-dy))+'px 0)':'';
 // Wall: the screen ends .07 of the head beyond her tilted reach; the .13 slide presses .06 into it like the desktop.
 const wallSide=preview.active&&preview.name.startsWith('slump_')?(preview.name.endsWith('_l')?-1:1):0;
 edge.hidden=!wallSide;
 // The taskbar spans the screen, so it ends at that edge too (tray clock in the corner).
 taskbar.style.left=taskbar.style.right='0';
 if(wallSide){
  const x=canvas.offsetLeft+size/2+wallSide*(REACH[wallSide]+.07)*size,beyond=stage.clientWidth-x;
  edge.style.left=wallSide>0?x+'px':'0';edge.style.right=wallSide>0?'0':'auto';edge.style.width=wallSide>0?'auto':x+'px';edge.dataset.side=wallSide>0?'right':'left';
  if(wallSide>0)taskbar.style.right=beyond+'px';else taskbar.style.left=x+'px';
 }
 const rect=stage.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),g=gestureCtx;
 const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);if(gestureCanvas.width!==w||gestureCanvas.height!==h){gestureCanvas.width=w;gestureCanvas.height=h;}
 g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,w,h);
 if(!cur||!renderer||renderer.solo)return;
 const r=canvas.getBoundingClientRect(),box={left:r.left-rect.left,top:r.top-rect.top,width:r.width,height:r.height};
 g.setTransform(dpr,0,0,dpr,0,0);
 const gestures=cur.guard||cur.rubEyes?headGestureHands(renderer,cur,box,{sink:showLedge?dy:0}):[];
 g.save();
 if(showLedge){
  g.beginPath();g.rect(0,0,rect.width,cutY+barH*.5);g.clip();
  // Ledge hands as on the desktop; the wall-side hand slides along with the lean.
  const alphaByHand=[1,1];for(const hand of gestures)alphaByHand[hand.i]*=1-hand.alpha;
  const hands=[0,1].map(i=>({x:lean?lean*(i===(lean<0?0:1)?.75:.4):0}));
  drawHands(g,{cx:canvas.offsetLeft+size/2+tow,ledgeY:cutY,s:size,hands,skin,alphaByHand});
  g.beginPath();g.rect(0,0,rect.width,cutY);g.clip();
 }
 if(gestures.length)drawHeadHands(g,gestures,skin);
 g.restore();
 // The tow preview's virtual pointer, drawn where it holds the ahoge.
 const p=preview.pointer(),layer=renderer.byName.get('ahoge');
 if(p&&layer){
  const o=renderer.project(TOW_GRIP.x,TOW_GRIP.y,cur,layer,true),k=r.width/240;
  const x=box.left+(o[0]+1)/2*r.width+p.x*k,y=box.top+(1-o[1])/2*r.height+p.y*k;
  g.beginPath();g.arc(x,y,Math.max(5,7*k*.6),0,Math.PI*2);g.fillStyle='rgba(255,255,255,.85)';g.fill();g.lineWidth=2;g.strokeStyle='rgba(20,30,60,.75)';g.stroke();
 }
}

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

$('#sizeCard').hidden=false;
for(const el of document.querySelectorAll('input.range'))progress(el);

/* Size */
{
  const el=$('#size');let pending=null,raf=0;track(el);
  el.addEventListener('input',()=>{progress(el);$('#sizeValue').textContent=el.value;pending=+el.value;if(!raf)raf=requestAnimationFrame(()=>{raf=0;if(pending!=null){const v=pending;pending=null;local.size=v;updatePreviewSize();}});});
}

/* Pose */
{
  let raf=0;
  const flush=()=>{raf=0;ctl?.set({follow:false,pose:{...local.pose}});};
  for(const k of AXES){
    const el=$('#'+k);track(el);
    const commit=v=>{local.pose={...local.pose,[k]:v};motion.pose[k]=v;if(preview.active)preview.basePose={...local.pose};$('#'+k+'Value').textContent=fmt(v);
      if(local.follow){local.follow=false;motion.follow=false;$('#follow').setAttribute('aria-pressed','false');}
      if(ctl&&!raf)raf=requestAnimationFrame(flush);};
    el.addEventListener('input',()=>{progress(el);commit(+el.value);});
    $('#'+k+'Value').addEventListener('dblclick',()=>{el.value=0;progress(el);commit(0);});
  }
}

/* Actions */
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{preview.stop();apply(local);motion.gesture(b.dataset.action);}));
$('#reset').addEventListener('click',()=>{
  endTouch();
  preview.stop();motion.follow=true;
  apply({follow:true,pose:{yaw:0,pitch:0,roll:0}});
  ctl?.action('reset');
});

/* Modes */
for(const k of MODES)$('#'+k).addEventListener('click',()=>{const value=$('#'+k).getAttribute('aria-pressed')!=='true';preview.stop();apply(local);send({[k]:value});});

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
function updatePreviewSize(){const r=stage.getBoundingClientRect(),side=Math.max(120,Math.min(local.size,Math.floor(Math.min(r.width,r.height)-24)));const px=Math.min(side,640)+'px';canvas.style.width=canvas.style.height=px;const m=$('#masterCompare');if(m)m.style.width=m.style.height=px;}
new ResizeObserver(updatePreviewSize).observe(stage);

/* Preview gaze: only while the cursor is over the stage. */
let attentionPointer=null,wakeFlag=false;
function brushFringe(x,y){if(!renderer)return;const r=canvas.getBoundingClientRect(),hit=renderer.pickHit(x-r.left,y-r.top);touchInput.hover(hit?.part,{x,y},r.width,hit);}
function gaze(x,y){brushFringe(x,y);attentionPointer={x,y};const r=canvas.getBoundingClientRect();motion.setGaze((x-r.left-r.width*.5)/(r.width*.7),(y-r.top-r.height*.6)/(r.height*.7));}
stage.addEventListener('pointermove',e=>gaze(e.clientX,e.clientY));
stage.addEventListener('pointerleave',()=>{attentionPointer=null;motion.setGaze(0,0);motion.touch.fringe.brush(null,canvas.clientWidth);});
addEventListener('blur',()=>{attentionPointer=null;motion.setGaze(0,0);motion.touch.fringe.brush(null,canvas.clientWidth);});
const touchInput=new TouchInput(motion.touch);
let touchPointer=null;
const canvasPoint=e=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0||touchPointer!==null||!renderer||motion.touch.bonking)return;
  const p=canvasPoint(e);if(!renderer.hitTest(p.x,p.y))return;
  if(preview.active){preview.release();apply(local);}
  touchPointer=e.pointerId;canvas.setPointerCapture(e.pointerId);
  if(motion.attention.current.sleeping){motion.touch.headTap=null;wakeFlag=true;return;}
  const hit=renderer.pickHit(p.x,p.y),part=hit?.part;
  const head=part==='hair_front'||(!part&&headContact(p.x,p.y,canvas.clientWidth));
  touchInput.begin(part,{x:e.clientX,y:e.clientY},canvas.clientWidth,hit,{head});
  if(!part)motion.blink();canvas.style.cursor=part==='ahoge'||part==='hair_front'?'grabbing':'';
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
window.bluefish={motion,preview,get renderer(){return renderer;},get rig(){return rig;},pause(v=true){paused=v;},render(patch={}){renderer?.render({...motion.current,...patch});},playPromptSoulSegment(segment,duration=3){for(const a of fromPromptSoulSegment(segment,duration))motion.playCue(a.cue,a.delay);}};

function syncPreview(){
 $('#previewTransport').hidden=!preview.active;
 for(const b of document.querySelectorAll('[data-preview]'))b.setAttribute('aria-pressed',String(preview.active&&preview.name===b.dataset.preview));
 if(preview.active){for(const k of MODES)$('#'+k).setAttribute('aria-pressed',String(!!motion[k]));const t=$('#previewTimeline');t.max=preview.duration;if(!active.has(t.id))t.value=preview.time;progress(t);$('#previewTime').textContent=preview.time.toFixed(1)+' / '+preview.duration;$('#previewPlay').textContent=preview.playing?'暂停':'播放';$('#previewRate').value=String(preview.rate);}
}
document.querySelectorAll('[data-preview]').forEach(button=>button.addEventListener('click',()=>{endTouch();preview.select(button.dataset.preview);syncPreview();}));
$('#previewPlay').addEventListener('click',()=>{if(preview.time>=preview.duration)preview.seek(0);preview.playing=!preview.playing;syncPreview();});
$('#previewRate').addEventListener('change',e=>preview.rate=+e.target.value);
const timeline=$('#previewTimeline');track(timeline);let pendingSeek=null,seekFrame=0;
timeline.addEventListener('input',()=>{pendingSeek=+timeline.value;if(!seekFrame)seekFrame=requestAnimationFrame(()=>{seekFrame=0;preview.seek(pendingSeek);renderer?.render(motion.current);drawGesture();syncPreview();});});

/* Initial state and live sync */
if(ctl){ctl.onState(apply);try{apply(await ctl.getState());}catch(error){fail(error);}}else apply(local);

try{
  const response=await fetch('assets/rig.json');if(!response.ok)throw Error('角色文件加载失败');rig=await response.json();
  renderer=await new Renderer(canvas,rig).init();skin=await sampleSkin();setStatus('ok','本地运行中');
  const initial=new URLSearchParams(location.search);if(initial.has('preview')){try{preview.select(initial.get('preview'));if(initial.has('at')){preview.seek(+initial.get('at'));preview.playing=false;}syncPreview();}catch{}}
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
    if(preview.active){preview.step(dt);}else{motion.attention.update(dt,{now:now/1000,reduced:motion.reduced,follow:motion.follow,x,y,size:r.width,near:!!p,overHead:!!p&&headContact(x,y,r.width),hx:(x/r.width-.5)/.3,hy:(y/r.height-.46)/.23,blocked:!!touchInput.active||motion.touch.bonking,wake:wakeFlag,poke:!!touchInput.active});
    wakeFlag=false;motion.step(dt);}
    renderer.render(motion.current);drawGesture();syncPreview();}last=now;requestAnimationFrame(draw);}
  requestAnimationFrame(draw);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();endTouch();paused=true;setStatus('error','显卡上下文已暂停');});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
}catch(error){fail(error);}
