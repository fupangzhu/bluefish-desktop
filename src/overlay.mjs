import {headContact} from './attention.mjs';
import {Motion} from './motion.mjs';
import {Renderer} from './renderer.mjs';
import {Peek} from './peek.mjs';
import {drawHands,makeSkin,sampleSkin} from './hands.mjs';
import {TouchInput} from './touch.mjs';

// ---- Tuning knobs ---------------------------------------------------------------------------------
// Art-space y (0..1 on the 2048 grid) of the horizontal cut line. The head canvas is placed so that
// this art row lands exactly on the taskbar edge; 0.73 covers the lower rim of the right eye.
export const CUT_ART_Y=0.73;
const RENDER_Y_SCALE=1.76;  // renderer.project: clip.y = -(y-0.5)*1.76
const GRIP_RATIO=0.05;      // fingertip overhang below the ledge (x size); main computes the window the same way
const NEAR_MIN=180;         // px, "near" = within max(1.05*s, NEAR_MIN) of the head centre
const NEAR_RATIO=1.05;
// ---------------------------------------------------------------------------------------------------

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pet=window.pet;
const params=new URLSearchParams(location.search);
const $=id=>document.getElementById(id);
const clip=$('clip'),canvas=$('avatar'),handsCanvas=$('hands'),taskbar=$('taskbar'),errorBox=$('error');
const handsCtx=handsCanvas.getContext('2d',{willReadFrequently:true});

const state={size:240,docked:true,follow:true,idle:true,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,pose:{yaw:0,pitch:0,roll:0}};
if(!pet){ // opened in a plain browser: size the pretend pet to the viewport so the layout is previewable
  document.documentElement.classList.add('preview');taskbar.hidden=false;
  state.size=clamp(+params.get('size')||Math.round(Math.min(innerWidth/1.3,innerHeight/(0.70+GRIP_RATIO))),150,460);
  state.docked=!params.has('free');
}

const motion=new Motion(),peek=new Peek({size:state.size});
motion.reduced=state.reduced;
let L={W:0,H:0,s:0,docked:true,grip:0,ledgeY:0,dpr:1};   // layout
let pos={left:0,top:0};                                    // current head canvas position (window px)
let skin=makeSkin();
let pointer=null,pointerAt=-1e9,pokeFlag=false,paused=false,lastHit=null,renderer=null,rig=null;
let lastPose={yaw:0,pitch:0,roll:0},lastMainFollow;
let activePointer=null;
const touchInput=new TouchInput(motion.touch,on=>pet?.drag(on));

function layout(){
  const W=innerWidth,H=innerHeight,s=state.size,docked=state.docked,grip=docked?Math.round(s*GRIP_RATIO):0,dpr=Math.min(devicePixelRatio||1,2);
  L={W,H,s,docked,grip,ledgeY:H-grip,dpr};
  peek.setSize(s);
  clip.style.height=L.ledgeY+'px';
  canvas.style.width=canvas.style.height=s+'px';
  handsCanvas.width=Math.round(W*dpr);handsCanvas.height=Math.round(H*dpr);
  handsCanvas.style.display=docked?'':'none';
  taskbar.style.height=grip+'px';
  place({offsetX:peek.head.value*s,bob:0});
}
const headFraction=()=>(1+(CUT_ART_Y-0.5)*RENDER_Y_SCALE)/2;   // where the cut row sits inside the canvas (0..1)
function place(out){
  const {W,H,s,docked,ledgeY}=L;
  if(docked){pos.left=(W-s)/2+out.offsetX;pos.top=ledgeY-s*headFraction()+out.bob;}
  else{pos.left=(W-s)/2;pos.top=(H-s)/2;}
  canvas.style.transform=`translate(${pos.left}px,${pos.top}px)`;
}
function drawHandsFrame(out){
  const g=handsCtx;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,handsCanvas.width,handsCanvas.height);
  if(!L.docked)return;
  g.setTransform(L.dpr,0,0,L.dpr,0,0);
  drawHands(g,{cx:L.W/2,ledgeY:L.ledgeY,s:L.s,hands:out.hands,skin,grip:L.grip});
}
function handsAlpha(x,y){
  if(!L.docked)return 0;
  const px=Math.floor(x*L.dpr),py=Math.floor(y*L.dpr);
  if(px<0||py<0||px>=handsCanvas.width||py>=handsCanvas.height)return 0;
  return handsCtx.getImageData(px,py,1,1).data[3];
}
function hitTest(x,y){
  if(handsAlpha(x,y)>24)return true;
  if(!renderer)return false;
  if(L.docked&&y>=L.ledgeY)return false;
  return renderer.hitTest(x-pos.left,y-pos.top);
}
function partAt(x,y){
  if(handsAlpha(x,y)>24||(L.docked&&y>=L.ledgeY))return null;
  return renderer?.pickPart(x-pos.left,y-pos.top)||null;
}

// ---- state coming from the main process ---------------------------------------------------------------
function applyState(next){
  Object.assign(state,{size:next.size??state.size,docked:next.docked??state.docked,idle:next.idle??state.idle,reduced:next.reduced??state.reduced});
  motion.idle=state.idle;motion.reduced=state.reduced;
  const poseNext=next.pose?{yaw:+next.pose.yaw||0,pitch:+next.pose.pitch||0,roll:+next.pose.roll||0}:state.pose;
  const poseChanged=['yaw','pitch','roll'].some(k=>poseNext[k]!==lastPose[k]),poseSet=!!(poseNext.yaw||poseNext.pitch||poseNext.roll);
  state.pose=poseNext;motion.pose={...poseNext};lastPose=poseNext;
  const followChanged=next.follow!==undefined&&next.follow!==lastMainFollow;
  if(next.follow!==undefined)lastMainFollow=next.follow;
  // setting a pose by hand turns mouse following off; going back to a zero pose / toggling the switch applies the main process value
  if(poseChanged&&poseSet)state.follow=false;
  else if((followChanged||poseChanged)&&next.follow!==undefined)state.follow=!!next.follow;
  motion.follow=state.follow;  layout();
}

// ---- input ------------------------------------------------------------------------------------------
function setPointer(p){pointer=p;pointerAt=performance.now();bluefish.pointer=p;if(p){touchInput.move(p);motion.setGaze(p.gx,p.gy);const hit=!!touchInput.active||hitTest(p.x,p.y);if(hit!==lastHit){lastHit=hit;bluefish.isInteractive=hit;pet?.setInteractive(hit);}}}
function onDown(e){
  if(e.button!==0||activePointer!==null||!hitTest(e.clientX,e.clientY))return;
  activePointer=e.pointerId;
  try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}
  const part=partAt(e.clientX,e.clientY);
  const grip=part==='ahoge'?renderer.pickHit(e.clientX-pos.left,e.clientY-pos.top):null;
  touchInput.begin(part,{x:e.clientX,y:e.clientY},L.s,grip);
  if(!part)motion.blink();pokeFlag=true;
  lastHit=true;pet?.setInteractive(true);
  document.documentElement.style.cursor=part==='ahoge'?'grabbing':'';
}
function endDrag(e){
  if(e?.pointerId!==undefined&&activePointer!==null&&e.pointerId!==activePointer)return;
  // Include the release coordinates in case the final movement preceded a pointer tick.
  if(e?.type==='pointerup')touchInput.move({x:e.clientX,y:e.clientY});
  touchInput.end(e?.type!=='pointerup');activePointer=null;lastHit=null;
  document.documentElement.style.cursor='';
}
for(const el of [canvas,handsCanvas]){
  el.addEventListener('pointerdown',onDown);
  el.addEventListener('pointercancel',endDrag);
  el.addEventListener('lostpointercapture',endDrag);
  el.addEventListener('contextmenu',e=>{e.preventDefault();endDrag();pokeFlag=true;pet?.menu();});
}
addEventListener('pointermove',e=>{if(e.pointerId===activePointer)touchInput.move({x:e.clientX,y:e.clientY});});
addEventListener('pointerup',endDrag);
addEventListener('blur',endDrag);
addEventListener('wheel',e=>{pokeFlag=true;if(e.ctrlKey){e.preventDefault();pet?.zoom(-Math.sign(e.deltaY));}},{passive:false});
addEventListener('resize',()=>layout());

// ---- main loop ---------------------------------------------------------------------------------------
let last=performance.now();
function frame(now){
  const dt=Math.min(0.1,Math.max(0,(now-last)/1000));last=now;
  if(handsCanvas.width!==Math.round(innerWidth*Math.min(devicePixelRatio||1,2))||L.H!==innerHeight)layout();
  if(!paused&&renderer){
    const s=L.s,cx=pos.left+s/2,cy=pos.top+s/2;
    const fresh=pointer&&performance.now()-pointerAt<800;
    let near=false;if(fresh)near=Math.hypot(pointer.x-cx,pointer.y-cy)<Math.max(NEAR_RATIO*s,NEAR_MIN);
    const follow=state.follow;
    const hx=fresh?(pointer.x-pos.left)/s:.5,hy=fresh?(pointer.y-pos.top)/s:.5;
    const attention=motion.attention.update(dt,{x:fresh?pointer.x:NaN,y:fresh?pointer.y:NaN,size:s,near,
      overHead:fresh&&(!L.docked||pointer.y<L.ledgeY)&&headContact(pointer.x-pos.left,pointer.y-pos.top,s),
      hx:(hx-.5)/.3,hy:(hy-.46)/.23,blocked:!!touchInput.active,poke:pokeFlag||!!touchInput.active});
    const out=peek.update(dt,{gx:fresh&&follow&&!touchInput.active?pointer.gx*attention.gazeWeight:0,gy:fresh&&follow?pointer.gy:0,near:attention.attentive||!follow,poke:pokeFlag||!!touchInput.active,docked:L.docked,reduced:state.reduced,hold:motion.blocksTravel(attention)});
    pokeFlag=false;
    motion.override=follow?out.override:null;
    if(out.gesture)motion.gesture(out.gesture);
    const cur=motion.step(dt);
    place({offsetX:L.docked?out.offsetX:0,bob:L.docked?out.bob:0});
    renderer.render(L.docked?{...cur,roll:cur.roll+out.roll}:cur);
    drawHandsFrame(out);
    bluefish.last=out;
  }
  requestAnimationFrame(frame);
}

const bluefish=window.bluefish={motion,peek,state,pointer:null,isInteractive:false,hitTest,partAt,touchInput,layout:()=>L,position:()=>pos,
  forceSulk(){peek.forceSulk();},forceStep(dir){peek.forceStep(dir);},pause(v=true){paused=v;},get renderer(){return renderer;},get rig(){return rig;},
  setPointer,get skin(){return skin;}};

// Listen for state before the async asset load so the first push from main is never missed.
if(pet)pet.onState(applyState);
layout();
try{
  const response=await fetch('assets/rig.json');if(!response.ok)throw Error('角色文件加载失败');rig=await response.json();
  renderer=await new Renderer(canvas,rig).init();
  skin=await sampleSkin();
  if(pet){
    pet.onPointer(setPointer);
    pet.onAction(name=>{pokeFlag=true;if(name==='reset'){endDrag();motion.reset();}else motion.gesture(name);});
  }else{
    applyState(state);
    addEventListener('pointermove',e=>{const s=L.s,cx=pos.left+s/2,cy=pos.top+s/2;setPointer({x:e.clientX,y:e.clientY,gx:clamp((e.clientX-cx)/(s*.7),-1,1),gy:clamp((e.clientY-cy)/(s*.7),-1,1)});});
    document.documentElement.addEventListener('pointerleave',()=>{pointer=null;motion.setGaze(0,0);});
  }
  layout();
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();endDrag();paused=true;});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  requestAnimationFrame(frame);
}catch(error){errorBox.hidden=false;errorBox.textContent=error.message;console.error(error);}
