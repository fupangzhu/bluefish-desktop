// Golden recorder for the motion port. Drives the JS Motion + Peek + TouchInput through a scripted
// session (pointer play, stroking, drags, head taps, ahoge pulls and tows, fringe, ears, gestures,
// wall slumps, being ignored, sleeping and waking) and records every call and every frame's output.
// tests/golden.rs replays the calls against the Rust port and compares the frames.
// Run: node native/golden/motion.mjs <out.json>
import fs from 'node:fs';
import {Motion} from '../../src/motion.mjs';
import {Peek} from '../../src/peek.mjs';
import {TouchInput} from '../../src/touch.mjs';
import {bindAhoge} from '../../src/ahoge.mjs';

import {mulberry32} from './rng.mjs';

const SEED=20261111,PEEK_SEED=7;
const motion=new Motion(mulberry32(SEED)),peek=new Peek({size:240,random:mulberry32(PEEK_SEED)});
const events=[];
const touchInput=new TouchInput(motion.touch,on=>events.push('drag:'+(on?1:0)));
const ops=[],frames=[];let frameIndex=0,sawReluctant=false;
const S=240;

// ---- scenario state (scripted, not part of the replay) ----
const scene=mulberry32(99);
let now=1000,follow=true,docked=true,reduced=false,idle=true,wall=[0,0],pointer=null,pokeFlag=false,wakeFlag=false;
const head={x:240,y:120};   // head-ish centre in window px
function call(op){
  ops.push(op);
  switch(op.op){
    case 'begin':{const r=touchInput.begin(op.part,op.point,op.size,op.grip,{head:op.head,tow:op.tow});if(op.tow&&op.limits)motion.touch.tow.setLimits(op.limits[0],op.limits[1]);break;}
    case 'move':touchInput.move(op.point);break;
    case 'end':{const b=touchInput.end(op.cancel);if(b)events.push('bonk');break;}
    case 'hover':touchInput.hover(op.part,op.point,op.size,op.grip);break;
    case 'slumpPoke':motion.slump.poke();break;
    case 'blink':motion.blink();break;
    case 'gesture':motion.gesture(op.name);break;
    case 'twitch':motion.touch.twitch(op.side);break;
    case 'dip':motion.touch.dip.start(0,'tow');break;
    case 'reset':motion.reset();break;
  }
}
function point(x,y){return {x,y,sx:x+500,sy:y+800};}
function grip(sx,sy){return {source:{x:sx,y:sy},binding:null,outline:null};}
function frame(dt){
  now+=dt;
  const fresh=!!pointer;
  const f={op:'frame',dt,now,fresh,x:pointer?.x??0,y:pointer?.y??0,gx:pointer?.gx??0,gy:pointer?.gy??0,innerSide:pointer?.innerSide??NaN,
    near:fresh&&Math.hypot(pointer.x-head.x,pointer.y-head.y)<Math.max(1.05*S,180),overHead:!!pointer?.overHead,hx:pointer?(pointer.x-head.x+S/2)/S:.5,hy:pointer?(pointer.y-head.y+S/2)/S:.5,
    poke:pokeFlag,wake:wakeFlag,follow,docked,reduced,idle,wall:[...wall]};
  f.hx=(f.hx-.5)/.3;f.hy=(f.hy-.46)/.23;
  if(!Number.isFinite(f.innerSide))delete f.innerSide;
  ops.push(f);
  motion.follow=follow;motion.idle=idle;motion.reduced=reduced;motion.wall={side:wall[0],gap:wall[1]};
  if(fresh)motion.setGaze(f.gx,f.gy);
  const attention=motion.attention.update(dt,{now:f.now,reduced,follow,innerSide:f.innerSide,x:fresh?f.x:NaN,y:fresh?f.y:NaN,size:S,near:f.near,overHead:f.overHead,hx:f.hx,hy:f.hy,blocked:!!touchInput.active||motion.touch.bonking,wake:wakeFlag,poke:pokeFlag||!!touchInput.active});
  const out=peek.update(dt,{gx:fresh&&follow&&!touchInput.active?f.gx*attention.gazeWeight:0,gy:fresh&&follow?f.gy:0,near:!attention.sleeping&&(attention.attentive||!follow),poke:!attention.sleeping&&(pokeFlag||!!touchInput.active),docked,reduced,hold:motion.blocksTravel(attention)});
  pokeFlag=false;wakeFlag=false;
  motion.override=follow?out.override:null;
  if(out.gesture&&!attention.rubbing&&!attention.sleeping&&!attention.woke&&!motion.wake.active&&!motion.touch.bonking&&!attention.reluctant?.active)motion.gesture(out.gesture);
  const cur=motion.step(dt);
  if(cur.towEnd&&cur.towEnd.traveled>0)motion.slump.arrive(motion.touch.dip.remaining);
  if(cur.reluctant)sawReluctant=true;
  const rec=flat(cur,attention,out);rec.frame=frameIndex;if(frameIndex%4===0||rec.events)frames.push(rec);frameIndex++;
}
const B=v=>typeof v==='boolean'?+v:v;
function flat(c,a,p){
  const o={};
  for(const k of ['sideEye','shiftX','shiftY','yaw','pitch','roll','gx','gy','left','right','hair','ahogeWag','ahogeSide','ahogeDroop','earMood','sleep','rubEyes','rubHand','rubPhase','rubLift','rub','relax','time','breath','slump','slumpSide','earPressL','earPressR',
    'fringeX','fringeY','fringeFocus','guard','bonk','pain','ahogePullX','ahogePullY','earFoldL','earFoldR','towing','towLean','towWince','towSlip','dip','dipMix','dipDir','dipKind','ahogeSway','reluctant','sleeping','movementBlocked','secondary'])o[k]=B(c[k]);
  if(c.earMoodL!==undefined)o.earMoodL=c.earMoodL;
  if(c.earSleepL!==undefined)o.earSleepL=c.earSleepL;
  o.wakePreset=c.wakePreset??null;o.rubReaction=c.rubReaction??null;
  if(c.towEnd){o['towEnd.traveled']=c.towEnd.traveled;o['towEnd.slipped']=+c.towEnd.slipped;o['towEnd.dir']=c.towEnd.dir;}
  for(const s of ['L','R']){const e=c['earTwitch'+s];if(e)for(const k of ['elapsed','count','period','amplitude'])o[`earTwitch${s}.${k}`]=e[k];}
  const g=c.ahogeGrab;if(g){o['grab.sourceX']=g.source.x;o['grab.sourceY']=g.source.y;o['grab.clientX']=g.client.x;o['grab.clientY']=g.client.y;o['grab.held']=+g.held;o['grab.releasedAt']=g.releasedAt;o['grab.strength']=g.strength;o['grab.slip']=+!!g.slip;}
  for(const k of ['gazeWeight','rub','relax','eyeCap','droop','yaw','roll','pitch','ahogeWag','sleep','sleepClosure','wakeId','inactiveFor','sleeping','woke','attentive','rubbing','resting','interacting'])o['att.'+k]=B(a[k]);
  o['att.reaction']=a.reaction??null;
  o['att.reluctant.active']=+!!a.reluctant?.active;o['att.reluctant.mix']=a.reluctant?.mix??0;o['att.reluctant.shiftX']=a.reluctant?.shiftX??0;
  o['peek.offsetX']=p.offsetX;o['peek.mode']=p.mode;o['peek.roll']=p.roll;o['peek.bob']=p.bob;o['peek.held']=+p.held;o['peek.gesture']=p.gesture??null;
  p.hands.forEach((h,i)=>{for(const k of ['x','lift','rot','squash','tap','tapSquash','squeeze'])o[`peek.hand${i}.${k}`]=h[k]||0;});
  if(p.override)for(const k of ['gx','gy','yaw','roll','eyeCap','droop'])if(p.override[k]!==undefined)o['peek.override.'+k]=p.override[k];
  o.events=events.splice(0).join(',');
  return o;
}

// ---- the session ----
const DT=1/30;
const run=(n,fn)=>{for(let i=0;i<n;i++){fn?.(i);frame(DT);}};
const at=(x,y,extra={})=>({x,y,gx:Math.max(-1,Math.min(1,(x-head.x)/(S*.7))),gy:Math.max(-1,Math.min(1,(y-head.y)/(S*.7))),innerSide:1,...extra});
const headPoint=(dx=0,dy=0)=>({x:240*.5+dx+120,y:240*.46+dy});

// A: pointer circling near her, brushing the fringe.
run(240,i=>{const a=i/30;pointer=at(head.x+Math.cos(a)*150,head.y+Math.sin(a*1.3)*90);if(i%3===0)call({op:'hover',part:i%2?'hair_front':null,point:point(pointer.x,pointer.y),size:S,grip:i%2?grip(900+i,800):null});});
// B: stroking the head (several sessions so each reaction shows up).
for(let s=0;s<5;s++){run(150,i=>{pointer=at(head.x+Math.sin(i/4)*30,head.y-10+Math.cos(i/5)*10,{overHead:true});});pointer=null;run(60);}
// C: carry her around: press body, drag, release.
for(let s=0;s<3;s++){const p=at(head.x,head.y+30);pointer=p;call({op:'begin',part:null,point:point(p.x,p.y),size:S,grip:null,head:false,tow:false});run(40,i=>{pointer=at(p.x+i*3,p.y);call({op:'move',point:point(pointer.x,pointer.y)});});call({op:'end',cancel:false});run(40);}
// D: double taps on the head until a few bonks happen.
for(let s=0;s<14;s++){const h=headPoint();pointer=at(h.x,h.y);for(let t=0;t<2;t++){call({op:'begin',part:null,point:point(h.x,h.y),size:S,grip:null,head:true,tow:false});run(3);call({op:'end',cancel:false});run(4);}run(scene()<.5?10:90);}
run(120);
// E: ahoge tow along the taskbar (screen coordinates move), then a hard lift that slips.
for(const [dx,dy,n] of [[6,0,70],[-7,0,70],[2,-6,60]]){const p=at(head.x+60,head.y-90);pointer=p;let x=p.x,y=p.y;
  call({op:'begin',part:'ahoge',point:point(x,y),size:S,grip:grip(1400,220),head:false,tow:true,limits:[-400,400]});
  run(n,()=>{x+=dx;y+=dy;call({op:'move',point:point(x,y)});});call({op:'end',cancel:false});run(150);}
// F: free (not towing) ahoge pull up and down.
{docked=false;const p=at(head.x+60,head.y-90);let x=p.x,y=p.y;call({op:'begin',part:'ahoge',point:point(x,y),size:S,grip:grip(1500,300),head:false,tow:false});run(50,i=>{y+=i<25?-2:3;x+=1;call({op:'move',point:point(x,y)});});call({op:'end',cancel:false});run(60);docked=true;}
// G: fringe: a small flick, then a long pull that turns into carrying her.
for(const reach of [10,60]){const h=headPoint(0,-20);pointer=at(h.x,h.y);call({op:'begin',part:'hair_front',point:point(h.x,h.y),size:S,grip:grip(1000,900),head:true,tow:false});run(30,i=>call({op:'move',point:point(h.x+reach*i/30,h.y+reach*i/60)}));call({op:'end',cancel:false});run(40);}
// H: ear taps, gestures, a requested duck.
call({op:'begin',part:'ear_l',point:point(150,60),size:S,grip:null,head:false,tow:false});run(2);call({op:'end',cancel:false});run(30);
call({op:'begin',part:'ear_r',point:point(330,90),size:S,grip:null,head:false,tow:false});run(2);call({op:'move',point:point(360,90)});run(2);call({op:'end',cancel:false});run(30);
for(const name of ['nod','shakehead','happy','wink','blink']){call({op:'gesture',name});run(60);}
call({op:'dip'});run(120);call({op:'twitch',side:'l'});run(30);
// I: resting against a wall until she slumps; a poke ends it. Then the other wall, and a tow
// that ends beside a wall (the arrival check).
wall=[1,12];pointer=null;for(let k=0;k<60&&motion.slump.phase!=='hold';k++)run(100);run(60);call({op:'slumpPoke'});run(60);
wall=[-1,0];for(let k=0;k<60&&motion.slump.phase!=='hold';k++)run(100);run(400);
{const p=at(head.x+60,head.y-90);let x=p.x;call({op:'begin',part:'ahoge',point:point(x,p.y),size:S,grip:grip(1400,220),head:false,tow:true,limits:[-400,400]});run(60,()=>{x+=6;call({op:'move',point:point(x,p.y)});});call({op:'end',cancel:false});run(300);}
wall=[0,0];run(60);
// J: she steps toward a pointer held to one side, is ignored (shuffles home, sulks), the owner
// comes back; repeated until the reluctant look-away has shown up.
for(let k=0;k<12&&!(k>=2&&sawReluctant);k++){
  pokeFlag=true;wakeFlag=true;run(1);run(200);
  pointer=at(head.x+200,head.y);run(150);pointer=at(head.x+200,head.y+1);run(150);
  pointer=null;run(1500);
  run(120,i=>{pointer=at(head.x+60+(i%20)*4,head.y-10);});run(120,i=>{pointer=at(head.x-80+(i%15)*5,head.y+10);});
}
// K: sleep (the wall clock jumps), wake by click, several times so different wake presets play.
for(let s=0;s<12;s++){pointer=null;run(400,()=>{now+=1.6;});pokeFlag=true;wakeFlag=true;run(1);run(260);pointer=at(head.x,head.y-10,{overHead:true});run(90);}
// L: reduced motion and idle off for a stretch, then back.
reduced=true;run(120);reduced=false;idle=false;run(120);idle=true;follow=false;run(120);follow=true;run(60);
call({op:'reset'});run(60);

fs.writeFileSync(process.argv[2]||'motion-golden.json',JSON.stringify({seed:SEED,peekSeed:PEEK_SEED,ops,frames}));
console.log(`frames ${frames.length}, ops ${ops.length}`);
