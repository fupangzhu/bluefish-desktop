import test from 'node:test';import assert from 'node:assert/strict';import {Doze,DOZE} from '../src/doze.mjs';
const tick=(d,n)=>{let s;for(let i=0;i<n;i++)s=d.step(.1,{sleeping:true});return s;};
test('sleep motions are tiny and slow; an ear twitches alone after minutes, never continuously',()=>{
 for(const draw of [0,.999]){
  const d=new Doze(()=>draw);let peak=0,events=[];
  for(let i=0;i<7600;i++){const s=d.step(.1,{sleeping:true});peak=Math.max(peak,Math.abs(s.breath));if(s.ear&&s.ear.at!==events.at(-1)?.at)events.push({...s.ear});assert.ok(Math.abs(s.wag)<4.46);}
  assert.ok(peak>.00239&&peak<=.0024);assert.ok(events.length>=3&&events.length<=6);
  assert.ok(events[0].at>=19.9&&events[0].at<=40.2);assert.equal(events[0].side,draw<.5?'l':'r');assert.equal(events[0].count,1);assert.equal(events[0].period,.12);
  for(let i=1;i<events.length;i++)assert.ok(events[i].at-events[i-1].at>=149.9);
 }
});
test('sleep bias changes gently to the other side, and waking or reduced motion suppresses it',()=>{
 const d=new Doze(()=>0);const a=tick(d,349);assert.ok(Math.abs(a.wag)<.66);const b=tick(d,102);assert.ok(b.wag<-2.8);const c=tick(d,800);assert.ok(c.wag>2.8);
 assert.deepEqual(d.step(.1,{sleeping:true,reduced:true}),{breath:0,wag:0,ear:null});assert.deepEqual(d.step(.1,{}),{breath:0,wag:0,ear:null});assert.equal(d.time,0);assert.equal(d.active,false);
});

test('the idle toggle also disables sleep micro-motions',async()=>{
 const {Motion}=await import('../src/motion.mjs');const m=new Motion(()=>0);m.idle=false;m.attention.lastInteraction=-601;m.attention.droop=1;m.attention.lastNear=-30;
 for(let i=0;i<1800;i++){m.attention.update(.1,{});const s=m.step(.1);assert.equal(s.ahogeWag,0);assert.equal(s.breath,0);assert.ok(s.earTwitchL==null);assert.ok(s.earTwitchR==null);}
 assert.equal(m.current.sleep,1);assert.equal(m.doze.time,0);
});

test('sleep timers follow wall time through low frame rates and long hidden gaps',()=>{
 const d=new Doze(()=>0);d.step(.016,{sleeping:true,now:100});const first=d.step(.016,{sleeping:true,now:121});assert.ok(d.time>20);assert.ok(first.ear&&first.ear.elapsed>0&&first.ear.elapsed<.12);
 const resumed=d.step(.016,{sleeping:true,now:721});assert.ok(d.time>600);assert.ok(resumed.ear);assert.ok(d.nextEar-d.time>=150);assert.equal(resumed.ear.count,1);
});
test('the tiny breath remains perceptible at minimum size and under one pixel at maximum size',()=>{
 assert.ok(DOZE.breathAmplitude*.88*150>.3);assert.ok(DOZE.breathAmplitude*.88*460<1);
});

test('a slow frame still renders a visible initial ear impulse instead of skipping its peak',async()=>{
 const {flick}=await import('../src/ears.mjs'),d=new Doze(()=>0);d.step(.1,{sleeping:true,now:0});const s=d.step(.1,{sleeping:true,now:21});assert.ok(s.ear);assert.ok(flick(s.ear.elapsed,s.ear)>.3);
});
