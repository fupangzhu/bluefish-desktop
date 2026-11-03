import test from 'node:test';
import assert from 'node:assert/strict';
import {Spring,Motion,validateCue,cueSample,fromPromptSoulSegment} from '../src/motion.mjs';
test('spring behaves identically at 30/60/120 FPS',()=>{const values=[30,60,120].map(fps=>{const s=new Spring();for(let i=0;i<fps;i++)s.step(10,1/fps);return s.value;});assert.ok(Math.max(...values)-Math.min(...values)<1e-10);});
test('blink closes and returns to open',()=>{const m=new Motion(()=>0.5);m.idle=false;m.blink();let min=1;for(let i=0;i<60;i++){m.step(1/120);min=Math.min(min,m.current.left);}assert.ok(min<0.05);assert.equal(m.current.left,1);});
test('tracking is clamped and finite at extreme input',()=>{const m=new Motion();m.setGaze(500,-500);m.setGaze(NaN,Infinity);for(let i=0;i<600;i++){const s=m.step(1/60);assert.ok(Math.abs(s.yaw)<=18&&Math.abs(s.pitch)<=12&&Math.abs(s.roll)<=10);assert.ok(Object.values(s).filter(v=>typeof v==='number').every(Number.isFinite));}});
test('cue is bounded, expires, and reset cancels it',()=>{const m=new Motion();m.idle=false;m.follow=false;const cue={duration:1,curves:[{parameter:'ParamAngleX',keys:[[0,0],[0.5,1000],[1,0]]}]};m.playCue(cue);for(let i=0;i<30;i++)m.step(1/60);assert.ok(m.current.yaw<=18);for(let i=0;i<240;i++)m.step(1/60);assert.ok(Math.abs(m.current.yaw)<0.01);m.playCue(cue);m.reset();assert.equal(m.queue.length,0);assert.deepEqual(cueSample(cue,1),{});});
test('wink affects one eye only and returns to neutral',()=>{const m=new Motion();m.idle=false;m.gesture('wink');for(let i=0;i<18;i++)m.step(1/60);assert.ok(m.current.left<.02);assert.equal(m.current.right,1);for(let i=0;i<60;i++)m.step(1/60);assert.equal(m.current.left,1);});
test('reject arbitrary parameters, malformed keys and lasting offsets',()=>{for(const curves of [[{parameter:'__proto__',keys:[[0,0],[0.5,1],[1,0]]}],[{parameter:'ParamAngleX',keys:[[0,0],[0.5,NaN],[1,0]]}],[{parameter:'ParamAngleX',keys:[[0,0],[0.5,1],[1,2]]}]])assert.throws(()=>validateCue({duration:1,curves}));});
test('PromptSoul resolved segment maps timing, unsupported body curve rejected',()=>{const s={seq:0,cues:[{at:0.25,span:0.5,curves:[{parameter:'ParamAngleY',minimum:-30,maximum:30,keys:[[0,0],[0.5,5],[1,0]]}]}]};const [r]=fromPromptSoulSegment(s,4);assert.equal(r.delay,1);assert.equal(r.cue.duration,2);s.cues[0].curves[0].parameter='ParamArmLA';assert.throws(()=>fromPromptSoulSegment(s,4));});
test('ahoge: null override and no gesture give exactly 0 wag / 0 droop',()=>{const m=new Motion(()=>0.5);for(let i=0;i<120;i++){m.step(1/60);assert.ok(Object.is(m.current.ahogeWag,0)&&Object.is(m.current.ahogeDroop,0));}});
test('ahoge: droop override wilts in about a second, perks up faster, and does not change the gaze',()=>{
  const m=new Motion(()=>0.5);const ctl=new Motion(()=>0.5);m.setGaze(0.5,0);ctl.setGaze(0.5,0);
  m.override={droop:1};let t=0;while(t<0.5){m.step(1/60);ctl.step(1/60);t+=1/60;}const half=m.current.ahogeDroop;while(t<1.2){m.step(1/60);ctl.step(1/60);t+=1/60;}
  assert.ok(half>0.3&&half<0.95);assert.ok(m.current.ahogeDroop>0.9&&m.current.ahogeDroop<=1);assert.ok(Math.abs(m.current.gx-ctl.current.gx)<1e-9);
  m.override=null;t=0;while(t<0.6){m.step(1/60);t+=1/60;}assert.ok(m.current.ahogeDroop<0.1);
});
test('ahoge: happy gesture wags for its 1.8s and then stops; reduced motion has no wag but keeps a static droop',()=>{
  const m=new Motion(()=>0.5);m.gesture('happy');let max=0;for(let i=0;i<90;i++){m.step(1/60);max=Math.max(max,Math.abs(m.current.ahogeWag));}
  assert.ok(max>5&&max<25);for(let i=0;i<60;i++)m.step(1/60);assert.ok(Object.is(m.current.ahogeWag,0));
  const r=new Motion(()=>0.5);r.reduced=true;r.gesture('happy');r.override={droop:0.7};for(let i=0;i<60;i++){r.step(1/60);assert.equal(r.current.ahogeWag,0);}assert.equal(r.current.ahogeDroop,0.7);
});
