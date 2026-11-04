import test from 'node:test';import assert from 'node:assert/strict';
import {Attention,headContact} from '../src/attention.mjs';
import {Motion} from '../src/motion.mjs';
import {Peek} from '../src/peek.mjs';
const frame=(a,m,dt,p)=>{const v=a.update(dt,p);if(m)m.step(dt);return v;};
const point={x:120,y:110,size:240,near:true,overHead:false,hx:0,hy:0};
test('a stationary nearby pointer loses attention and droops instead of watching forever',()=>{
 const m=new Motion(()=>.5);m.idle=false;m.setGaze(1,0);const a=m.attention,p=new Peek();
 let s;for(let i=0;i<20*60;i++){s=frame(a,m,1/60,point);p.update(1/60,{near:s.attentive,gx:s.gazeWeight});}
 assert.ok(s.gazeWeight<.001);assert.ok(s.droop>.98);assert.ok(Math.abs(m.current.gx)<.001);assert.ok(m.current.earMood<-.95);
 for(let i=0;i<60*35;i++){s=frame(a,m,1/60,point);p.update(1/60,{near:s.attentive,gx:s.gazeWeight});}assert.equal(p.mode,'sulk');
});
test('far moving cursor is ignored; fresh nearby movement restores gaze',()=>{
 const a=new Attention();let s;for(let i=0;i<600;i++)s=a.update(1/60,{...point,x:1000+i,near:false});assert.ok(s.gazeWeight<.01);
 for(let i=0;i<90;i++)s=a.update(1/60,{...point,x:120+Math.sin(i*.12)*25});assert.ok(s.gazeWeight>.98);assert.ok(s.attentive);
});
test('rubbing settles into closed eyes and restores motion after the departure delay',()=>{
 const m=new Motion(()=>.5);m.idle=false;m.setGaze(.8,0);let early=0;
 for(let i=0;i<5*60;i++){const x=Math.sin(i/60*5);frame(m.attention,m,1/60,{...point,x:120+x*32,overHead:true,hx:x});if(i<120)early=Math.max(early,Math.abs(m.current.yaw));}
 assert.ok(early>.3&&early<7);assert.ok(m.current.left<.01&&m.current.right<.01);assert.ok(Math.abs(m.current.yaw)<.05);
 for(let i=0;i<6*60;i++)frame(m.attention,m,1/60,{...point,x:230+i,overHead:false});
 assert.ok(m.current.left>.98);assert.ok(m.current.yaw>5);assert.ok(m.current.rub<.001);
});
test('hover alone, dragging, and hair pulling do not activate a head rub',()=>{
 for(const blocked of [false,true]){const a=new Attention();let s;for(let i=0;i<300;i++)s=a.update(1/60,{...point,x:blocked?120+Math.sin(i)*15:120,overHead:true,blocked});assert.ok(s.rub<.001);assert.ok(s.relax<.01);}
 assert.ok(headContact(120,110,240));assert.equal(headContact(235,90,240),false);assert.equal(headContact(120,12,240),false);
});
test('relaxation and release are consistent across frame rates and avatar sizes',()=>{
 const simulate=(fps,size)=>{const a=new Attention();for(let i=0;i<fps*4;i++)a.update(1/fps,{...point,size,x:size*(.5+.14*Math.sin(i/fps*6)),overHead:true});return a.current;};
 const samples=[simulate(30,150),simulate(60,240),simulate(120,460)];for(const s of samples){assert.ok(s.relax>.99&&s.rub>.99&&s.eyeCap<.01);}
});

test('startup and reset give attention a grace period before drooping',()=>{const a=new Attention();let s;for(let i=0;i<120;i++)s=a.update(1/60,{});assert.ok(s.droop<.001);a.reset();assert.equal(a.current.droop,0);});

test('active manipulation stays alert even outside the nearby zone',()=>{const a=new Attention();let s;for(let i=0;i<20*60;i++)s=a.update(1/60,{x:900,y:-100,size:240,near:false,overHead:true,blocked:true,poke:true});assert.ok(s.droop<.001&&s.rub<.001&&s.eyeCap>.99);});

test('departure samples a 2–5 second hold once and keeps both eyes closed until it expires',()=>{
 for(const random of [0,1]){
  const m=new Motion(()=>random);m.idle=false;
  for(let i=0;i<300;i++)frame(m.attention,m,1/60,{...point,x:120+30*Math.sin(i*.1),overHead:true});
  frame(m.attention,m,1/60,{...point,x:300,overHead:false});
  const start=m.attention.time,until=m.attention.restUntil,delay=until-start;assert.ok(Math.abs(delay-(2+random*3))<1e-8);
  while(m.attention.time+1/60<until){const s=frame(m.attention,m,1/60,{...point,x:300,overHead:false});assert.ok(s.resting);assert.ok(m.current.left<.01&&m.current.right<.01);assert.equal(m.attention.restUntil,until);}
  for(let i=0;i<100;i++)frame(m.attention,m,1/60,{...point,x:300+i,overHead:false});assert.ok(m.current.left>.98&&m.current.right>.98);assert.equal(m.attention.current.resting,false);
 }
});
test('returning to rub reschedules the next departure; manipulation and reset cancel the hold',()=>{
 let count=0;const a=new Attention(()=>{count++;return count===1?.2:.8;});
 for(let i=0;i<300;i++)a.update(1/60,{...point,x:120+30*Math.sin(i*.1),overHead:true});
 a.update(1/60,{...point,overHead:false});assert.equal(count,1);const first=a.restUntil;
 a.update(1/60,{...point,overHead:true});assert.equal(a.current.resting,false);assert.ok(a.current.eyeCap<.01);
 a.update(1/60,{...point,overHead:false});assert.equal(count,2);assert.ok(a.restUntil>first);
 a.update(1/60,{...point,overHead:false,blocked:true,poke:true});assert.equal(a.current.resting,false);assert.equal(a.restUntil,0);
 a.reset();assert.equal(a.restUntil,0);assert.equal(a.current.eyeCap,1);
});
