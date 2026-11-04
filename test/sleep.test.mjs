import test from 'node:test';import assert from 'node:assert/strict';
import {Sleep} from '../src/sleep.mjs';import {Motion} from '../src/motion.mjs';import {deformEar} from '../src/ears.mjs';import {readFileSync} from 'node:fs';
const dt=1/60;

test('sleep never starts before 2min, samples once, and is certain at 10min',()=>{
 for(const draw of [0,.099,.1,.55,1]){
  let calls=0;const s=new Sleep(()=>{calls++;return draw;});
  for(let i=0;i<500;i++)s.update(dt,{idleFor:119});assert.equal(s.sleeping,false);assert.equal(calls,0);
  s.update(dt,{idleFor:120});assert.equal(calls,1);const deadline=s.deadline;assert.ok(deadline>=120&&deadline<=600);
  for(let age=121;age<=600;age++){s.update(dt,{idleFor:age});assert.equal(s.deadline,deadline);assert.equal(calls,1);if(age<deadline)assert.equal(s.sleeping,false);}
  assert.equal(s.sleeping,true);
 }
});

test('cumulative sleep probability grows with idle time and is independent of frame count',()=>{
 let seed=8765;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;},counts=[0,0,0,0];
 for(let i=0;i<1000;i++){
  const s=new Sleep(random);for(const [j,age] of [120,240,360,600].entries()){s.update(dt,{idleFor:age});if(s.sleeping)counts[j]++;}
 }
 assert.ok(counts[0]>=60&&counts[0]<=150);assert.ok(counts[1]>counts[0]&&counts[2]>counts[1]);assert.equal(counts[3],1000);
 const a=new Sleep(()=>.55),b=new Sleep(()=>.55);a.update(1/30,{idleFor:120});b.update(1/120,{idleFor:120});assert.equal(a.deadline,b.deadline);
});

test('waking reopens eyes before raising the head, and restarts the idle lottery',()=>{
 const s=new Sleep(()=>0);for(let i=0;i<300;i++)s.update(dt,{idleFor:120+i*dt});assert.equal(s.closure,1);assert.equal(s.depth,1);
 s.update(dt,{idleFor:0,active:true});assert.equal(s.sleeping,false);assert.equal(s.deadline,null);assert.ok(s.closure>0);assert.equal(s.depth,1);
 while(s.closure>0){s.update(dt,{idleFor:0,active:true});assert.equal(s.depth,1);}
 const opened=s.time;while(s.time-opened<.08){s.update(dt,{idleFor:0,active:true});assert.equal(s.depth,1);}
 for(let i=0;i<240;i++)s.update(dt,{idleFor:0,active:true});assert.equal(s.closure,0);assert.equal(s.depth,0);
 s.update(dt,{idleFor:119});assert.equal(s.sleeping,false);s.update(dt,{idleFor:600});assert.equal(s.sleeping,true);s.reset();assert.equal(s.depth,0);
});

test('desktop wall time counts hidden intervals; far movement does not wake a sleeper',()=>{
 const m=new Motion(()=>1);m.idle=false;const input={x:900,y:900,size:240,near:false};
 for(let i=0;i<30*60;i++){m.attention.update(dt,{...input,now:i*dt});m.step(dt);}
 m.attention.update(dt,{...input,now:119});assert.equal(m.attention.current.sleeping,false);
 m.attention.update(dt,{...input,now:599});assert.equal(m.attention.current.sleeping,false);
 m.attention.update(dt,{...input,now:601});m.step(dt);assert.equal(m.current.sleeping,true);
 for(let i=0;i<300;i++){m.attention.update(dt,{...input,x:900+i,now:601+i*dt});m.step(dt);}
 assert.equal(m.current.sleep,1);assert.equal(m.current.left,0);assert.equal(m.current.right,0);assert.ok(m.current.earMood<-.99);assert.ok(m.blocksTravel());
 m.attention.update(dt,{...input,near:true,x:120,y:120,now:607});m.step(dt);assert.equal(m.current.sleeping,false);assert.equal(m.attention.current.inactiveFor,0);
 for(let i=0;i<420;i++){m.attention.update(dt,{...input,near:true,x:120+Math.sin(i)*15,y:120,now:607+i*dt});m.step(dt);}
 assert.equal(m.current.sleep,0);assert.ok(m.current.left>.99);assert.equal(m.blocksTravel(),false);
});

test('sleep bends both ear tips lower than sulking while keeping roots pinned',()=>{
 const rig=JSON.parse(readFileSync(new URL('../assets/rig.json',import.meta.url),'utf8'));
 for(const name of ['ear_l','ear_r']){
  const l=rig.layers.find(l=>l.name===name),side=name==='ear_l'?-1:1,tip=[l.pivot[0]+side*(l.box[2]-l.box[0])*.5,l.pivot[1]-50];
  const droop=deformEar(...tip,l,{earMood:-1}),sleep=deformEar(...tip,l,{earMood:-1,sleep:1});assert.ok(sleep[1]>droop[1]+10);assert.deepEqual(deformEar(...l.pivot,l,{earMood:-1,sleep:1}),l.pivot);
 }
});

test('a stationary cursor on the scalp cannot prevent inactivity sleep indefinitely',()=>{
 const m=new Motion(()=>0);m.idle=false;const p={x:120,y:110,size:240,near:true,overHead:true};
 for(let i=0;i<30*60;i++){m.attention.update(dt,{...p,x:i<240?120+30*Math.sin(i*.1):120});m.step(dt);}
 assert.equal(m.attention.current.rubbing,false);assert.ok(m.attention.current.droop>.9);
 m.attention.lastInteraction=m.attention.idleTime-121;for(let i=0;i<300;i++){m.attention.update(dt,p);m.step(dt);}assert.equal(m.current.sleeping,true);assert.equal(m.current.left,0);
});


test('returning after 10 hidden minutes sleeps even if the app was hidden while attentive',()=>{
 const m=new Motion(()=>1);m.idle=false;
 m.attention.update(dt,{now:0,x:120,y:110,size:240,near:true});m.step(dt);assert.equal(m.attention.current.droop,0);
 m.attention.update(dt,{now:601});m.step(dt);assert.equal(m.current.sleeping,true);
});


test('waking overrides residual droopy eyelids before the sleeping posture rises',()=>{
 const m=new Motion(()=>0);m.idle=false;const far={x:900,y:900,size:240,near:false};
 m.attention.droop=1;m.attention.lastNear=-30;m.attention.lastInteraction=-601;
 for(let i=0;i<300;i++){m.attention.update(dt,far);m.step(dt);}assert.equal(m.current.sleep,1);
 for(let i=0;i<300;i++){
  m.attention.update(dt,{...far,x:120+Math.sin(i*.1)*20,y:110,near:true});m.step(dt);
  if(m.current.sleep<1&&m.current.sleep>0){assert.ok(m.current.left>.99&&m.current.right>.99);}
 }
 assert.equal(m.current.sleep,0);
});
