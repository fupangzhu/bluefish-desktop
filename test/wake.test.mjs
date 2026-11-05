import test from 'node:test';import assert from 'node:assert/strict';import {Wake} from '../src/wake.mjs';import {Motion} from '../src/motion.mjs';
const dt=1/60;
test('wake presets are drawn once per transition in 60 / 25 / 15 outcome proportions',()=>{
 let seed=789;const w=new Wake(()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;}),counts={rubeyes:0,peek:0,gentle:0,stretch:0,lookaround:0};
 for(let i=0;i<1000;i++){w.start();counts[w.preset]++;}
 assert.ok(counts.rubeyes>200&&counts.rubeyes<300);assert.ok(counts.peek>100&&counts.peek<200);const normal=counts.gentle+counts.stretch+counts.lookaround;assert.ok(normal>550&&normal<650);
});
test('each preset waits for open eyes, has a distinct small motion, and finishes at neutral',()=>{
 const peaks={};for(const [name,draw] of [['gentle',.2],['stretch',.4],['lookaround',.55]]){
  let calls=0;const w=new Wake(()=>{calls++;return draw;});w.start();for(let i=0;i<180;i++)assert.deepEqual(w.step(dt),{yaw:0,pitch:0,roll:0,gx:0,wag:0,ears:0});assert.equal(w.elapsed,0);assert.equal(calls,1);
  const p={yaw:0,pitch:0,wag:0};for(let i=0;i<240;i++){const s=w.step(dt,{eyesOpen:true});for(const k of Object.keys(p))p[k]=Math.max(p[k],Math.abs(s[k]));}assert.equal(w.active,false);peaks[name]=p;
 }
 assert.ok(peaks.stretch.pitch>peaks.gentle.pitch*2);assert.ok(peaks.lookaround.yaw>3);assert.equal(peaks.gentle.yaw,0);
});
test('reduced motion and reset clear the preset without oscillation',()=>{const w=new Wake(()=>.55);w.start();for(let i=0;i<60;i++)assert.ok(Object.values(w.step(dt,{eyesOpen:true,reduced:true})).every(n=>n===0));assert.equal(w.active,false);w.start();w.reset();assert.equal(w.active,false);});
test('hovering, scalp rubbing, wheel-style activity, and a held pointer do not wake sleep',()=>{
 const m=new Motion(()=>0);m.idle=false;m.attention.lastInteraction=-601;m.attention.droop=1;m.attention.lastNear=-30;
 for(let i=0;i<300;i++){m.attention.update(dt,{x:900,y:900,size:240,near:false});m.step(dt);}assert.equal(m.current.sleep,1);
 for(let i=0;i<600;i++){
  m.attention.update(dt,{x:120+30*Math.sin(i*.1),y:110,size:240,near:true,overHead:true,poke:i%60===0,blocked:i%80<10});m.step(dt);
  assert.equal(m.current.sleeping,true);assert.equal(m.current.left,0);assert.equal(m.current.wakePreset,null);assert.ok(Math.abs(m.current.ahogeWag)<4);assert.equal(m.attention.current.rubbing,false);
 }
});
test('one explicit click chooses a wake preset; further awake clicks never re-roll it',()=>{
 const m=new Motion(()=>0);m.idle=false;let calls=0;m.wake.random=()=>{calls++;return .55;};m.attention.lastInteraction=-601;m.attention.droop=1;m.attention.lastNear=-30;
 for(let i=0;i<300;i++){m.attention.update(dt,{});m.step(dt);}m.attention.update(dt,{wake:true,poke:true});m.step(dt);
 assert.equal(m.current.sleeping,false);assert.equal(m.current.wakePreset,'lookaround');assert.equal(calls,1);
 for(let i=0;i<420;i++){m.attention.update(dt,{wake:true,poke:true});m.step(dt);}assert.equal(calls,1);assert.equal(m.current.wakePreset,null);assert.equal(m.current.sleep,0);
});

test('eye rub keeps the eyes closed under moving hands, then opens slowly before travel',()=>{
 const m=new Motion(()=>0);m.idle=false;m.wake.random=()=>.7;m.attention.lastInteraction=-601;m.attention.droop=1;m.attention.lastNear=-30;
 for(let i=0;i<300;i++){m.attention.update(dt,{});m.step(dt);}
 m.attention.update(dt,{wake:true});m.step(dt);assert.equal(m.wake.preset,'rubeyes');
 let rubbed=false,half=false,opened=false;
 for(let i=0;i<330;i++){
  m.attention.update(dt,{});const s=m.step(dt),t=m.wake.elapsed;
  if(s.wakePreset==='rubeyes'&&t>2&&t<3){assert.ok(s.rubEyes>.9);assert.equal(s.left,0);assert.equal(s.right,0);rubbed=true;}
  if(s.left>.2&&s.left<.8&&t>3.2)half=true;
  if(s.wakePreset==='rubeyes')assert.ok(m.blocksTravel());
  if(s.left>.99&&s.right>.99)opened=true;
 }
 assert.ok(rubbed&&half&&opened);assert.equal(m.wake.active,false);assert.equal(m.current.rubEyes,0);
});
