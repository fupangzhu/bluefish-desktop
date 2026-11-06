import {headContact} from './attention.mjs';
import {Motion} from './motion.mjs';
import {Renderer} from './renderer.mjs';
import {Peek} from './peek.mjs';
import {drawHands,drawHeadHands,headGestureHands,makeSkin,sampleSkin} from './hands.mjs';
import {TouchInput} from './touch.mjs';

// ---- Tuning knobs ---------------------------------------------------------------------------------
// Art-space y (0..1 on the 2048 grid) of the horizontal cut line. The head canvas is placed so that
// this art row lands exactly on the taskbar edge; 0.73 covers the lower rim of the right eye.
export const CUT_ART_Y=0.73;
const RENDER_Y_SCALE=1.76;  // renderer.project: clip.y = -(y-0.5)*1.76
const VIEW_PAD=.35;
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
let pointer=null,pointerAt=-1e9,pokeFlag=false,wakeFlag=false,paused=false,lastHit=null,renderer=null,rig=null;
let lastPose={yaw:0,pitch:0,roll:0},lastMainFollow;
let activePointer=null;
let track=null,wall={side:0,gap:0},towOrigin=null,towSent=null;   // docked window range / nearby screen edge from main
const touchInput=new TouchInput(motion.touch,on=>pet?.drag(on));
// Head shift toward the wall while slumping: close the gap and press a little further, so the
// squashed wall-side ear stays flat against the screen edge.
const slumpShift=()=>clamp(wall.gap+.06*L.s,0,.5*L.s);

function layout(){
  const W=innerWidth,H=innerHeight,s=state.size,docked=state.docked,grip=docked?Math.round(s*GRIP_RATIO):0,dpr=Math.min(devicePixelRatio||1,2);
  L={W,H,s,docked,grip,ledgeY:H-grip,dpr};
  peek.setSize(s);
  clip.style.height=L.ledgeY+'px';
  canvas.style.width=canvas.style.height=s*(1+2*VIEW_PAD)+'px';
  handsCanvas.width=Math.round(W*dpr);handsCanvas.height=Math.round(H*dpr);
  handsCanvas.style.display='';
  taskbar.style.height=grip+'px';
  if(renderer&&motion.current&&bluefish.last)drawFrame(motion.current,bluefish.last);
  else place({offsetX:docked?peek.head.value*s:0,bob:0});
}
const headFraction=()=>(1+(CUT_ART_Y-0.5)*RENDER_Y_SCALE)/2;   // where the cut row sits inside the canvas (0..1)
function place(out){
  const {W,H,s,docked,ledgeY}=L;
  const sleep=motion.current?.sleep||0,rubLift=(motion.current?.rubLift||0)*s;
  if(docked){pos.left=(W-s)/2+out.offsetX;pos.top=ledgeY-s*headFraction()+out.bob+s*.085*sleep-rubLift;}
  else{pos.left=(W-s)/2;pos.top=(H-s)/2+s*.025*sleep-rubLift;}
  const dip=motion.current?.dip||0,slump=motion.current?.slump||0,side=motion.current?.slumpSide||0;
  // Docked she ducks behind the taskbar edge; floating there is no edge, so only a small crouch.
  if(docked){pos.top+=s*dip+s*.05*slump;if(slump&&side===wall.side)pos.left+=side*slumpShift()*slump;}
  else pos.top+=s*dip*.3;
  canvas.style.transform=`translate(${pos.left-VIEW_PAD*s}px,${pos.top-VIEW_PAD*s}px)`;
}
function drawFrame(cur,out){
  const pose=L.docked?{...cur,roll:cur.roll+out.roll}:cur;
  place({offsetX:L.docked?out.offsetX:0,bob:L.docked?out.bob:0});
  renderer.render(pose);
  const g=handsCtx;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,handsCanvas.width,handsCanvas.height);
  const sink=L.docked?((pose.dip||0)+.05*(pose.slump||0))*L.s:0;
  const gestures=pose.guard>.001||pose.rubEyes>.001?headGestureHands(renderer,pose,canvas.getBoundingClientRect(),{sink}):[];
  g.setTransform(L.dpr,0,0,L.dpr,0,0);
  if(L.docked){
    const alphaByHand=[1,1];
    for(const hand of gestures)alphaByHand[hand.i]*=1-hand.alpha;
    const lean=(pose.slump||0)*(pose.slumpSide===wall.side?pose.slumpSide*slumpShift():0);
    const hands=lean?out.hands.map((h,i)=>({...h,x:(h.x||0)+lean*(i===(lean<0?0:1)?.75:.4)})):out.hands;
    drawHands(g,{cx:L.W/2,ledgeY:L.ledgeY,s:L.s,hands,skin,alphaByHand});
    g.save();g.beginPath();g.rect(0,0,L.W,L.ledgeY);g.clip();
    drawHeadHands(g,gestures,skin);g.restore();
  }else drawHeadHands(g,gestures,skin);
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
  return renderer.hitTest(x-pos.left+VIEW_PAD*L.s,y-pos.top+VIEW_PAD*L.s);
}
function partAt(x,y){
  if(handsAlpha(x,y)>24||(L.docked&&y>=L.ledgeY))return null;
  return renderer?.pickPart(x-pos.left+VIEW_PAD*L.s,y-pos.top+VIEW_PAD*L.s)||null;
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
function setPointer(p){pointer=p;pointerAt=performance.now();bluefish.pointer=p;if(p){
  track=p.win||null;wall=p.wall&&L.docked?{side:Math.sign(p.wall.side)||0,gap:+p.wall.gap||0}:{side:0,gap:0};motion.wall=wall;
  if(track&&towOrigin!==null)motion.touch.tow.setLimits(track.min-towOrigin,track.max-towOrigin);touchInput.move(p);const hover=renderer?.pickHit(p.x-pos.left+VIEW_PAD*L.s,p.y-pos.top+VIEW_PAD*L.s);touchInput.hover(hover?.part,p,L.s,hover);motion.setGaze(p.gx,p.gy);const hit=!!touchInput.active||hitTest(p.x,p.y);if(hit!==lastHit){lastHit=hit;bluefish.isInteractive=hit;pet?.setInteractive(hit);}}}
const eventPoint=e=>({x:e.clientX,y:e.clientY,sx:e.screenX,sy:e.screenY});
function onDown(e){
  if(e.button!==0||activePointer!==null||motion.touch.bonking||!hitTest(e.clientX,e.clientY))return;
  activePointer=e.pointerId;
  try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}
  if(motion.attention.current.sleeping){motion.touch.headTap=null;wakeFlag=true;pokeFlag=true;lastHit=true;pet?.setInteractive(true);return;}
  const part=partAt(e.clientX,e.clientY);
  const grip=part==='ahoge'||part==='hair_front'?renderer.pickHit(e.clientX-pos.left+VIEW_PAD*L.s,e.clientY-pos.top+VIEW_PAD*L.s):null;
  const head=!handsAlpha(e.clientX,e.clientY)&&(part==='hair_front'||(!part&&headContact(e.clientX-pos.left,e.clientY-pos.top,L.s)));
  motion.slump.poke();
  // Docked: a sideways tug on the ahoge leads her along the taskbar (needs the main process to move the window).
  const tow=!!pet&&L.docked&&part==='ahoge',point=eventPoint(e);
  if(tow){towOrigin=point.sx-point.x;towSent=null;}
  touchInput.begin(part,point,L.s,grip,{head,tow});
  if(tow&&track)motion.touch.tow.setLimits(track.min-towOrigin,track.max-towOrigin);
  if(!part)motion.blink();pokeFlag=true;
  lastHit=true;pet?.setInteractive(true);
  document.documentElement.style.cursor=part==='ahoge'||part==='hair_front'?'grabbing':'';
}
function endDrag(e){
  if(e?.pointerId!==undefined&&activePointer!==null&&e.pointerId!==activePointer)return;
  // Include the release coordinates in case the final movement preceded a pointer tick.
  if(e?.type==='pointerup')touchInput.move(eventPoint(e));
  const moved=touchInput.active?.part==='body'&&touchInput.active.moved;
  touchInput.end(e?.type!=='pointerup');
  if(moved)motion.slump.arrive();activePointer=null;lastHit=null;
  document.documentElement.style.cursor='';
}
for(const el of [canvas,handsCanvas]){
  el.addEventListener('pointerdown',onDown);
  el.addEventListener('pointercancel',endDrag);
  el.addEventListener('lostpointercapture',endDrag);
  el.addEventListener('contextmenu',e=>{e.preventDefault();endDrag();pokeFlag=true;pet?.menu();});
}
addEventListener('pointermove',e=>{if(e.pointerId===activePointer)touchInput.move(eventPoint(e));});
addEventListener('pointerup',endDrag);
addEventListener('blur',()=>{endDrag();touchInput.hover(null,null,L.s);});
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
    const attention=motion.attention.update(dt,{now:now/1000,reduced:state.reduced,follow:state.follow,innerSide:pointer?.innerSide,x:fresh?pointer.x:NaN,y:fresh?pointer.y:NaN,size:s,near,
      overHead:fresh&&(!L.docked||pointer.y<L.ledgeY)&&headContact(pointer.x-pos.left,pointer.y-pos.top,s),
      hx:(hx-.5)/.3,hy:(hy-.46)/.23,blocked:!!touchInput.active||motion.touch.bonking,wake:wakeFlag,poke:pokeFlag||!!touchInput.active});
    const out=peek.update(dt,{gx:fresh&&follow&&!touchInput.active?pointer.gx*attention.gazeWeight:0,gy:fresh&&follow?pointer.gy:0,near:!attention.sleeping&&(attention.attentive||!follow),poke:!attention.sleeping&&(pokeFlag||!!touchInput.active),docked:L.docked,reduced:state.reduced,hold:motion.blocksTravel(attention)});
    pokeFlag=false;wakeFlag=false;
    motion.override=follow?out.override:null;
    if(out.gesture&&!attention.rubbing&&!attention.sleeping&&!attention.woke&&!motion.wake.active&&!motion.touch.bonking&&!attention.reluctant?.active)motion.gesture(out.gesture);
    const cur=motion.step(dt);
    if(cur.towEnd&&cur.towEnd.traveled>0)motion.slump.arrive(motion.touch.dip.remaining);
    const tow=motion.touch.tow;
    if(towOrigin!==null){
      if(tow.busy){const x=Math.round(towOrigin+tow.offset);if(x!==towSent){towSent=x;pet?.tow?.(x);}}
      else{towOrigin=null;towSent=null;}
    }
    drawFrame(cur,out);
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
  renderer=await new Renderer(canvas,rig).init();renderer.padding=VIEW_PAD;
  skin=await sampleSkin();
  if(pet){
    pet.onPointer(setPointer);
    pet.onAction(name=>{pokeFlag=true;if(name==='reset'){endDrag();motion.reset();}else motion.gesture(name);});
  }else{
    applyState(state);
    addEventListener('pointermove',e=>{const s=L.s,cx=pos.left+s/2,cy=pos.top+s/2;setPointer({...eventPoint(e),gx:clamp((e.clientX-cx)/(s*.7),-1,1),gy:clamp((e.clientY-cy)/(s*.7),-1,1)});});
    document.documentElement.addEventListener('pointerleave',()=>{pointer=null;motion.setGaze(0,0);});
  }
  layout();
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();endDrag();paused=true;});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  requestAnimationFrame(frame);
}catch(error){errorBox.hidden=false;errorBox.textContent=error.message;console.error(error);}
