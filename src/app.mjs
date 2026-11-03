import {Motion,fromPromptSoulSegment} from './motion.mjs';
import {Renderer} from './renderer.mjs';
const overlay=new URLSearchParams(location.search).has('overlay');
if(overlay)document.documentElement.classList.add('overlay');
const canvas=document.querySelector('#avatar'),status=document.querySelector('#status');
const motion=new Motion();motion.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
document.querySelector('#reduced').checked=motion.reduced;
try{
  const response=await fetch('assets/rig.json');if(!response.ok)throw Error('角色文件加载失败');const rig=await response.json();
  const renderer=await new Renderer(canvas,rig).init();status.textContent='本地运行中';
  const solo=document.querySelector('#soloLayer');
  if(solo){for(const layer of rig.layers){const opt=document.createElement('option');opt.value=layer.name;opt.textContent=layer.name+(layer.empty?'（空层）':'');solo.append(opt);}solo.addEventListener('change',()=>renderer.solo=solo.value||null);}
  let last=performance.now(),paused=false,lastHit=null;
  function draw(now){if(!paused){motion.step(Math.min(.1,(now-last)/1000));renderer.render(motion.current);}last=now;requestAnimationFrame(draw);}
  requestAnimationFrame(draw);
  // A small, documented debug interface also supports embedding into another UI.
  window.bluefish={motion,renderer,rig,pause(v=true){paused=v;},render(patch={}){renderer.render({...motion.current,...patch});},playPromptSoulSegment(segment,duration=3){for(const a of fromPromptSoulSegment(segment,duration))motion.playCue(a.cue,a.delay);}};
  const frame=document.querySelector('#petFrame');let scene={size:200,docked:true},settingsTimer,pendingSettings={};
  function configureScene(value){scene={...scene,...value};scene.size=Math.max(80,Math.min(640,Math.round(Number(scene.size)||200)));scene.edge=Math.round(scene.size*.64);document.documentElement.classList.toggle('docked',scene.docked);frame.style.setProperty('--pet-size',scene.size+'px');frame.style.setProperty('--dock-edge',scene.edge+'px');document.querySelector('#dock').checked=scene.docked;document.querySelector('#desktopSize').value=scene.size;document.querySelector('#desktopSizeNumber').value=scene.size;window.bluefish.settings={...scene};lastHit=null;}
  function updateSettings(patch){configureScene(patch);clearTimeout(settingsTimer);if(window.pet){pendingSettings={...pendingSettings,...patch};settingsTimer=setTimeout(()=>{const patch=pendingSettings;pendingSettings={};window.pet.updateSettings(patch).then(value=>value&&configureScene(value)).catch(console.error);},50);}}
  window.bluefish.updateSettings=updateSettings;configureScene(scene);
  document.querySelector('#dock').addEventListener('change',e=>updateSettings({docked:e.target.checked}));document.querySelector('#desktopSize').addEventListener('input',e=>updateSettings({size:+e.target.value}));document.querySelector('#desktopSizeNumber').addEventListener('change',e=>updateSettings({size:+e.target.value}));
  if(window.pet){window.pet.onSettings(configureScene);const value=await window.pet.getSettings();if(value)configureScene(value);document.querySelector('#settingsHint').textContent='实时控制桌面角色 · Ctrl＋滚轮也可调大小';}
  function hitTest(x,y){if(scene.docked){const c=canvas.getBoundingClientRect();for(const hand of document.querySelectorAll('.hand')){const r=hand.getBoundingClientRect(),hx=x+c.left-(r.left+r.width/2),hy=y+c.top-(r.top+r.height/2);if((hx/(r.width*.46))**2+(hy/(r.height*.45))**2<=1)return true;}if(y>=scene.edge)return false;}return renderer.hitTest(x,y);}
  window.bluefish.hitTest=hitTest;
  function gaze(x,y){const r=canvas.getBoundingClientRect();motion.setGaze((x-r.left-r.width*.5)/(r.width*.7),(y-r.top-r.height*.6)/(r.height*.7));}
  if(window.pet&&overlay){
    window.pet.onPointer(p=>{window.bluefish.pointer=p;motion.setGaze(p.gx,p.gy);const hit=hitTest(p.x,p.y);if(hit!==lastHit){lastHit=hit;window.bluefish.isInteractive=hit;window.pet.setInteractive(hit);}});
    frame.addEventListener('pointerdown',e=>{if(e.button===0){frame.setPointerCapture(e.pointerId);motion.blink();window.pet.drag(true);}});
    function endDrag(){window.pet.drag(false);lastHit=null;}
    addEventListener('pointerup',endDrag);
    frame.addEventListener('pointercancel',endDrag);
    frame.addEventListener('lostpointercapture',endDrag);
    addEventListener('blur',endDrag);
    frame.addEventListener('contextmenu',e=>{e.preventDefault();window.pet.menu();});
    addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();window.pet.resizeStep(e.deltaY<0?1:-1);}},{passive:false});
    window.pet.onAction(name=>{if(name==='toggle-follow')motion.follow=!motion.follow;else if(name==='toggle-idle')motion.idle=!motion.idle;else if(name==='reset')motion.reset();else motion.gesture(name);});
  }else{
    addEventListener('pointermove',e=>gaze(e.clientX,e.clientY));
    addEventListener('blur',()=>motion.setGaze(0,0));
    canvas.addEventListener('pointerdown',()=>motion.blink());
  }
  for(const key of ['follow','idle','reduced'])document.querySelector('#'+key).addEventListener('change',e=>{motion[key]=e.target.checked;});
  for(const key of ['yaw','pitch','roll'])document.querySelector('#'+key).addEventListener('input',e=>{motion.follow=false;document.querySelector('#follow').checked=false;motion.pose[key]=+e.target.value;document.querySelector('#'+key+'Value').textContent=e.target.value+'°';});
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>motion.gesture(b.dataset.action)));
  document.querySelector('#reset').addEventListener('click',()=>{motion.reset();motion.follow=true;document.querySelector('#follow').checked=true;for(const key of ['yaw','pitch','roll']){document.querySelector('#'+key).value=0;document.querySelector('#'+key+'Value').textContent='0°';}});
  document.querySelector('#background').addEventListener('click',()=>document.querySelector('#preview').classList.toggle('dark'));
  document.querySelector('#showMaster')?.addEventListener('click',()=>{const existing=document.querySelector('#masterCompare');if(existing){existing.remove();canvas.style.visibility='';return;}const image=new Image();image.id='masterCompare';image.src=rig.master;image.alt='固定坐标的完整母版';image.className='master-compare';document.querySelector('#preview').append(image);canvas.style.visibility='hidden';});
  function importMotion(data){if(data.cues)window.bluefish.playPromptSoulSegment(data);else motion.playCue(data);document.querySelector('#cueStatus').textContent='动作已通过校验并加入播放队列';}
  document.querySelector('#cueFile').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>100000)throw Error('文件超过 100KB');importMotion(JSON.parse(await file.text()));}catch(error){document.querySelector('#cueStatus').textContent=error.message;}finally{e.target.value='';}});
  document.querySelector('#demoCue').addEventListener('click',async()=>{try{const r=await fetch('examples/promptsoul-segment.json');importMotion(await r.json());}catch(error){document.querySelector('#cueStatus').textContent=error.message;}});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();paused=true;status.textContent='显卡上下文已暂停';});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
}catch(error){status.textContent='加载失败';const el=document.querySelector('#error');el.hidden=false;el.textContent=error.message;console.error(error);}
