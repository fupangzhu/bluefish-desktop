import test from 'node:test';
import assert from 'node:assert/strict';
import {Peek,CONFIG} from '../src/peek.mjs';
import {Motion} from '../src/motion.mjs';
const DT=1/30;
// Runs the machine for `seconds`; `input` may be an object or a function of time.
function run(p,seconds,input,log){let out;const n=Math.round(seconds/DT);for(let i=0;i<n;i++){out=p.update(DT,typeof input==='function'?input(p.time):input);log?.(out,p.time);}return out;}
const watching={gx:0,gy:0,near:true,poke:false};
test('no step before the gaze has been held, then one step toward the gaze',()=>{
  const p=new Peek({size:240});
  run(p,0.5,{...watching,gx:0.8});assert.equal(p.committed,0);assert.equal(p.mode,'rest');
  run(p,0.4,{...watching,gx:0.8});assert.equal(p.mode,'stepping');
  const out=run(p,1,{...watching,gx:0.8});
  assert.ok(Math.abs(p.committed-CONFIG.stepSize)<1e-9);assert.ok(out.offsetX>0);
});
test('gaze flicker or weak gaze does not step; ignored cursor (not near) does not step',()=>{
  const p=new Peek({size:240});
  run(p,5,t=>({...watching,gx:Math.floor(t*2)%2?0.8:-0.8}));assert.equal(p.committed,0);
  run(p,5,{...watching,gx:0.3});assert.equal(p.committed,0);
  const q=new Peek({size:240});run(q,5,{gx:0.9,near:false,poke:false});assert.equal(q.committed,0);
});
test('steps lead with the hand on the step side, lift and squash',()=>{
  const p=new Peek({size:300});let maxLift=0,maxSquash=0;
  p.forceStep(1);
  run(p,0.8,watching,o=>{maxLift=Math.max(maxLift,o.hands[1].lift);maxSquash=Math.max(maxSquash,o.hands[1].squash);assert.ok(o.hands[0].lift<=o.hands[1].lift+300*0.09);});
  assert.ok(maxLift>300*0.02&&maxLift<=300*0.026);assert.ok(maxSquash>0.05);
  const last=p.snapshot();assert.ok(Math.abs(last.hands[0].x-last.hands[1].x)<1e-9);assert.ok(Math.abs(last.hands[1].x-300*CONFIG.stepSize)<1e-6);
});
test('respects max offset and cooldown between steps',()=>{
  const p=new Peek({size:240});const starts=[];let prev='rest';
  run(p,20,{...watching,gx:1},(o,t)=>{if(o.mode==='stepping'&&prev!=='stepping')starts.push(t);prev=o.mode;assert.ok(Math.abs(o.hands[0].x)<=240*CONFIG.maxOffset+1e-6);});
  assert.equal(starts.length,2);assert.ok(Math.abs(p.committed-CONFIG.maxOffset)<1e-9);
  assert.ok(starts[1]-starts[0]>=CONFIG.stepDuration+CONFIG.cooldown-0.1);
  run(p,5,{...watching,gx:-1});assert.ok(p.committed<CONFIG.maxOffset);
});
test('ignored 45s: walks back to 0 one step at a time, then sulks',()=>{
  const p=new Peek({size:240});run(p,12,{...watching,gx:1});assert.ok(p.committed>0.1);
  const seen=new Set(),positions=new Set();
  run(p,44,{gx:0,near:false,poke:false},o=>seen.add(o.mode));assert.ok(!seen.has('returning')&&!seen.has('sulk'));assert.ok(p.committed>0.1);
  run(p,40,{gx:0,near:false,poke:false},(o)=>{seen.add(o.mode);positions.add(+p.committed.toFixed(4));});
  assert.ok(seen.has('returning'));assert.ok(positions.has(0.06));assert.equal(p.committed,0);
  assert.equal(p.mode,'sulk');assert.ok(p.snapshot().override);
});
test('sulk looks away from the cursor, flips when the cursor reaches her facing side, eyes capped',()=>{
  const p=new Peek({size:240});
  let out=run(p,50,{gx:-0.8,near:false,poke:false});
  assert.equal(out.mode,'sulk');assert.ok(out.override.gx>0&&out.override.yaw>0&&out.override.eyeCap===CONFIG.eyeCap);
  out=run(p,1,{gx:0.1,near:false,poke:false});assert.ok(out.override.gx>0); // small wobble: hysteresis
  out=run(p,1,{gx:0.8,near:false,poke:false});assert.ok(out.override.gx<0&&out.override.yaw<0);
  out=run(p,1,{gx:-0.1,near:false,poke:false});assert.ok(out.override.gx<0);
});
test('near for 0.6s ends the sulk with exactly one happy; poke ends it immediately',()=>{
  const p=new Peek({size:240});run(p,50,{gx:0.8,near:false,poke:false});assert.equal(p.mode,'sulk');
  const gestures=[];run(p,0.5,{gx:0,near:true,poke:false},o=>o.gesture&&gestures.push(o.gesture));assert.equal(p.mode,'sulk');assert.equal(gestures.length,0);
  run(p,0.3,{gx:0,near:false,poke:false});run(p,0.5,{gx:0,near:true,poke:false},o=>o.gesture&&gestures.push(o.gesture));assert.equal(p.mode,'sulk');// timer was reset
  const out=run(p,0.3,{gx:0,near:true,poke:false},o=>o.gesture&&gestures.push(o.gesture));
  assert.deepEqual(gestures,['happy']);assert.equal(p.mode,'rest');assert.equal(out.override,null);
  run(p,5,{gx:0,near:true,poke:false},o=>o.gesture&&gestures.push(o.gesture));assert.equal(gestures.length,1);
  const q=new Peek({size:240});run(q,50,{gx:0.8,near:false,poke:false});
  const g=q.update(DT,{gx:0.8,near:false,poke:true}).gesture;assert.equal(g,'happy');assert.equal(q.mode,'rest');
});
test('free mode never shuffles but still sulks; resizing keeps fractions',()=>{
  const p=new Peek({size:240});run(p,10,{...watching,gx:1,docked:false});assert.equal(p.committed,0);
  const out=run(p,50,{gx:0.8,near:false,poke:false,docked:false});assert.equal(out.mode,'sulk');
  const q=new Peek({size:200});q.forceStep(1);run(q,1,watching);const a=q.snapshot().offsetX;q.setSize(400);assert.ok(Math.abs(q.snapshot().offsetX-2*a)<1e-6);
});
test('reduced motion snaps without hand lift',()=>{
  const p=new Peek({size:240});let lift=0;run(p,3,{...watching,gx:1,reduced:true},o=>{lift=Math.max(lift,o.hands[0].lift,o.hands[1].lift);});
  assert.equal(lift,0);assert.ok(p.committed>0);
});
test('motion override: null is a no-op, set overrides gaze, adds yaw/roll and caps eyes while blinks continue',()=>{
  const a=new Motion(()=>0.5),b=new Motion(()=>0.5);b.override=null;
  for(let i=0;i<200;i++){a.step(1/60);b.step(1/60);}assert.deepEqual(a.current,b.current);
  const m=new Motion(()=>0.5);m.idle=false;m.setGaze(-1,0);m.override={gx:0.85,gy:0.1,yaw:12,roll:2.5,eyeCap:0.55};
  for(let i=0;i<120;i++)m.step(1/60);
  assert.ok(m.current.yaw>10&&m.current.gx>0.8&&Math.abs(m.current.left-0.55)<1e-9&&Math.abs(m.current.right-0.55)<1e-9);
  m.blink();let min=1;for(let i=0;i<30;i++){m.step(1/120);min=Math.min(min,m.current.left);}assert.ok(min<0.2);
});
test('ahoge droop: sulk drives droop to ~1, returning home ramps 0.3-0.6, the happy gesture perks it up',()=>{
  const p=new Peek({size:240}),m=new Motion(()=>0.5);m.idle=false;
  const frame=(input)=>{const out=p.update(DT,input);m.override=out.override;if(out.gesture)m.gesture(out.gesture);m.step(DT);return out;};
  p.forceStep(1);for(let i=0;i<40;i++)frame({...watching});assert.ok(p.committed>0);
  let sawReturn=false,minRet=9,maxRet=0;
  for(let i=0;i<DT*0+30*70;i++){const out=frame({gx:0,gy:0,near:false,poke:false});if(out.mode==='returning'){sawReturn=true;const d=out.override.droop;minRet=Math.min(minRet,d);maxRet=Math.max(maxRet,d);assert.equal(out.override.gx,undefined);}}
  assert.ok(sawReturn&&minRet>=0.3-1e-9&&maxRet<=0.6+1e-9);assert.equal(p.mode,'sulk');assert.equal(p.snapshot().override.droop,1);assert.ok(m.current.ahogeDroop>0.95);
  let wag=0;for(let i=0;i<60;i++){frame({...watching,poke:true});wag=Math.max(wag,Math.abs(m.current.ahogeWag));}
  assert.ok(wag>3);assert.ok(m.current.ahogeDroop<0.1);assert.equal(p.snapshot().override,null);
});
test('hands idle micro-motion: independent squeeze, occasional taps (injectable random), none when reduced',()=>{
  let r=0;const p=new Peek({size:240,random:()=>(r=(r+0.37)%1)});
  let taps=[0,0],prev=[0,0],squeezes=[new Set(),new Set()];
  run(p,40,watching,o=>o.hands.forEach((h,i)=>{if(h.tap>0&&!prev[i])taps[i]++;prev[i]=h.tap;squeezes[i].add(h.squeeze.toFixed(2));assert.ok(h.tap>=0&&h.tap<=1&&h.tapSquash>=0&&h.tapSquash<=1&&Math.abs(h.squeeze)<=1);}));
  assert.ok(taps[0]>=3&&taps[1]>=3);assert.ok(squeezes[0].size>10&&squeezes[1].size>10);
  const a=new Peek({size:240,random:()=>0.5}),b=new Peek({size:240,random:()=>0.5});
  const oa=run(a,3.1,watching),ob=run(b,3.1,watching);assert.deepEqual(oa.hands,ob.hands);assert.notEqual(oa.hands[0].squeeze,oa.hands[1].squeeze);
  const q=new Peek({size:240,random:()=>0});run(q,30,{...watching,reduced:true},o=>o.hands.forEach(h=>assert.ok(h.tap===0&&h.tapSquash===0&&h.squeeze===0)));
});


test('a held step freezes hands and head, then resumes without a jump',()=>{
 const p=new Peek({random:()=>.5});p.forceStep(1);p.update(.18,watching);const before=p.snapshot(),phase=p.step.t;
 const held=run(p,6,{...watching,gx:1,hold:true});assert.equal(p.step.t,phase);assert.equal(held.offsetX,before.offsetX);assert.equal(held.roll,before.roll);assert.equal(held.bob,before.bob);assert.deepEqual(held.hands,before.hands);assert.ok(held.held);
 p.update(.01,{...watching,gx:1});assert.ok(p.step.t>phase);assert.ok(Math.abs(p.snapshot().offsetX-held.offsetX)<1);run(p,1,watching);assert.equal(p.step,null);
});

test('holding resets the gaze timer instead of queuing a step behind closed eyes',()=>{
 const p=new Peek();run(p,.6,{...watching,gx:1});run(p,5,{...watching,gx:1,hold:true});assert.equal(p.step,null);assert.equal(p.gazeTimer,0);
 run(p,.5,{...watching,gx:1});assert.equal(p.step,null);run(p,.3,{...watching,gx:1});assert.ok(p.step);
});


test('petting can cheer up a sulking pet while travel remains paused',()=>{
 const p=new Peek();p.forceSulk();let happy=0;run(p,1,{...watching,hold:true},out=>{if(out.gesture==='happy')happy++;assert.equal(out.offsetX,0);assert.ok(out.held);});assert.equal(happy,1);assert.equal(p.mode,'rest');assert.equal(p.step,null);
});
