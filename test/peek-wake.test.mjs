import test from 'node:test';import assert from 'node:assert/strict';import {Wake,WAKE} from '../src/wake.mjs';import {Motion} from '../src/motion.mjs';import {deformEar} from '../src/ears.mjs';import {readFileSync} from 'node:fs';
const dt=1/60;
function sleeper(draw=.95){const m=new Motion(()=>0);m.idle=false;m.wake.random=()=>draw;m.attention.lastInteraction=-601;m.attention.droop=1;m.attention.lastNear=-30;for(let i=0;i<360;i++){m.attention.update(dt,{});m.step(dt);}assert.equal(m.current.sleep,1);return m;}
function tick(m,input={}){m.attention.update(dt,input);return m.step(dt);}
test('peek raises only the screen-left ear and eye while the body and sleep latch stay asleep',()=>{
 const m=sleeper(),rig=JSON.parse(readFileSync(new URL('../assets/rig.json',import.meta.url),'utf8')),before=m.current,wakeId=m.attention.current.wakeId;tick(m,{wake:true,poke:true});assert.equal(m.current.wakePreset,'peek');
 let eye=0,ear=0;
 for(let i=0;i<180;i++){
  const s=tick(m,{x:120+30*Math.sin(i*.1),y:110,size:240,near:true,overHead:true,poke:i%60===0});
  assert.ok(s.sleeping&&s.sleep===1&&m.blocksTravel());assert.equal(s.right,0);assert.equal(s.rubEyes,0);assert.equal(m.attention.current.wakeId,wakeId);assert.ok(s.earTwitchR==null);
  eye=Math.max(eye,s.left);ear=Math.max(ear,s.earMoodL??-1);
  const r=rig.layers.find(l=>l.name==='ear_r'),tip=[r.pivot[0]+180,r.pivot[1]-50];const a=deformEar(...tip,r,s),b=deformEar(...tip,r,before);assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6);
 }
 assert.ok(eye>.2&&eye<=.22);assert.ok(ear>.4);assert.equal(m.current.left,0);assert.equal(m.wake.active,false);assert.equal(m.current.sleeping,true);
});
test('a second click during the peek must really wake, even when the random value would choose peek',()=>{
 for(const draw of [0,.5,.9,1]){
  const m=sleeper();tick(m,{wake:true});for(let i=0;i<45;i++)tick(m);m.wake.random=()=>draw;tick(m,{wake:true,poke:true});
  assert.equal(m.current.sleeping,false);assert.notEqual(m.current.wakePreset,'peek');assert.ok(m.blocksTravel());
  for(let i=0;i<420;i++)tick(m,{poke:true});assert.equal(m.current.sleep,0);assert.equal(m.wake.active,false);
 }
});
test('the retry guard lasts 15 seconds after returning to sleep and expires on the real clock',()=>{
 const w=new Wake(()=>1);assert.equal(w.request(100),false);
 let clock=100;while(w.active){clock+=dt;w.step(dt,{clock});}assert.ok(Math.abs(w.protectUntil-clock-WAKE.retryWindow)<1e-8);
 assert.equal(w.request(clock+15),true);assert.equal(w.preset,'rubeyes');w.finish();assert.equal(w.request(clock+15.01),false);assert.equal(w.preset,'peek');
});
test('guarded outcomes still include normal and rubbing but exclude peek across every draw',()=>{
 const seen=new Set();for(let i=0;i<=100;i++){const w=new Wake(()=>.99);w.request(0);w.random=()=>i/100;assert.equal(w.request(.1),true);assert.notEqual(w.preset,'peek');seen.add(w.preset);}
 assert.ok(seen.has('gentle')&&seen.has('rubeyes'));const w=new Wake(()=>1);w.request(0);w.reset();assert.equal(w.request(1),false);
});
test('no hovering, scalp movement or wheel-style poke re-rolls or interrupts a peek',()=>{
 const m=sleeper();let calls=0;m.wake.random=()=>{calls++;return .95;};tick(m,{wake:true});for(let i=0;i<360;i++)tick(m,{x:120+40*Math.sin(i),y:110,size:240,near:true,overHead:true,poke:i%20===0});assert.equal(calls,1);assert.equal(m.current.sleeping,true);assert.equal(m.current.left,0);
});
test('a fresh sleeping click chooses its preset only once, including full normal/rub outcomes',()=>{
 for(const [draw,name] of [[.1,'gentle'],[.4,'stretch'],[.55,'lookaround'],[.7,'rubeyes'],[.95,'peek']]){
  const m=sleeper();let calls=0;m.wake.random=()=>{calls++;return draw;};tick(m,{wake:true,poke:true});assert.equal(m.current.wakePreset,name);for(let i=0;i<15;i++)tick(m);assert.equal(calls,1);
 }
});
test('reduced motion keeps a subtle eye cue, returns to sleep and preserves the retry rule',()=>{
 const m=sleeper();m.reduced=true;tick(m,{wake:true,reduced:true});let maxEye=0,maxEar=-1;
 for(let i=0;i<120;i++){const s=tick(m,{reduced:true});assert.ok(s.sleeping&&s.sleep===1&&s.right===0);maxEye=Math.max(maxEye,s.left);maxEar=Math.max(maxEar,s.earMoodL??-1);}
 assert.ok(maxEye>.1&&maxEar<0);assert.equal(m.wake.active,false);tick(m,{wake:true,reduced:true});assert.equal(m.current.sleeping,false);assert.notEqual(m.wake.preset,'peek');
});
