import test from 'node:test';
import assert from 'node:assert/strict';
import {AHOGE_REST,bindAhoge,deformAhoge,solveAhoge} from '../src/ahoge.mjs';
import {Touch} from '../src/touch.mjs';
const near=(a,b,eps=.001)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<eps,JSON.stringify({a,b}));

test('material binding preserves the original curl including points off its centreline',()=>{
  for(const point of [{x:1143.222,y:503.018},{x:1410,y:117},{x:1560,y:265},{x:1460,y:365}])near(deformAhoge(bindAhoge(point),null),point);
});
test('the actual pinched material point follows the hand while the root remains fixed',()=>{
  const source={x:1535,y:280},target={x:1575,y:250},pose=solveAhoge(source,target);
  near(deformAhoge(bindAhoge(source),pose),target);
  for(let i=0;i<=pose.rootIndex;i++)near(deformAhoge(bindAhoge(AHOGE_REST[i]),pose),AHOGE_REST[i]);
  assert.equal(pose.stretch,0);
});
test('the curl straightens using its slack before it can stretch',()=>{
  const source=AHOGE_REST[38],rest=solveAhoge(source,source),root=AHOGE_REST[rest.rootIndex];
  const dx=source.x-root.x,dy=source.y-root.y,chord=Math.hypot(dx,dy),axis={x:dx/chord,y:dy/chord};
  const middle={x:root.x+axis.x*(chord+(rest.length-chord)*.65),y:root.y+axis.y*(chord+(rest.length-chord)*.65)};
  const straight=solveAhoge(source,middle);assert.equal(straight.phase,'straighten');assert.equal(straight.stretch,0);near(deformAhoge(bindAhoge(source),straight),middle);
  const target={x:root.x+axis.x*rest.length*1.08,y:root.y+axis.y*rest.length*1.08};
  const taut=solveAhoge(source,target);assert.equal(taut.phase,'stretch');assert.ok(taut.stretch>0&&taut.stretch<.18);
  near(deformAhoge(bindAhoge(source),taut),target);
  const far=solveAhoge(source,{x:1e6,y:-1e6});assert.ok(far.stretch<=.18);assert.ok(far.curve.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
test('zero release strength recovers the exact art and repeated grips retain the current shape',()=>{
  const source={x:1535,y:280},target={x:1575,y:250},pose=solveAhoge(source,target);
  const base=AHOGE_REST.map(p=>deformAhoge(bindAhoge(p),pose));
  const again=solveAhoge(source,target,{base});near(deformAhoge(bindAhoge(source),again),target);
  const released=solveAhoge(source,target,{strength:0,held:false});
  for(const point of AHOGE_REST)near(deformAhoge(bindAhoge(point),released),point);
});
test('release bounces briefly, clears the grip, and leaves no persistent pull',()=>{
  const touch=new Touch(()=>.5);touch.startPull({x:0,y:0},{source:{x:1410,y:135}});touch.movePull({x:20,y:-30},240);
  assert.equal(touch.step(.1).ahogeGrab.held,true);touch.endPull();let overshoot=false;
  for(let i=0;i<80;i++){const s=touch.step(.01);if(s.ahogeGrab?.strength<0)overshoot=true;}
  assert.ok(overshoot);assert.equal(touch.grab,null);assert.equal(touch.step(.1).pain,0);
});
test('idle ear flutter waits a random 60–120 seconds and is softer than a click',()=>{
  for(const random of [0,.5,.999]){
    const touch=new Touch(()=>random),deadline=touch.nextEarAt;
    assert.ok(deadline>=60&&deadline<=120);
    while(touch.idleTime<deadline-.11){touch.step(.1);assert.equal(touch.ears.l,null);assert.equal(touch.ears.r,null);}
    let max=0,started=false;
    for(let i=0;i<70;i++){
      const s=touch.step(.01);max=Math.max(max,s.earFoldL,s.earFoldR);if(touch.ears.l||touch.ears.r)started=true;
    }
    assert.ok(started);assert.ok(max>.2&&max<=.38);assert.ok(touch.nextEarAt-touch.idleTime>59);
  }
});
test('idle off, reduced motion, and active pinches suppress the automatic ear timer',()=>{
  const touch=new Touch(()=>0);
  for(let i=0;i<1500;i++)touch.step(.1,false,false);assert.equal(touch.idleTime,0);
  for(let i=0;i<1500;i++)touch.step(.1,true,true);assert.equal(touch.idleTime,0);
  touch.startPull({x:0,y:0});for(let i=0;i<1500;i++)touch.step(.1,false,true);assert.equal(touch.idleTime,0);
  assert.equal(touch.ears.l,null);assert.equal(touch.ears.r,null);
  touch.endPull();touch.twitch('r');assert.ok(touch.nextEarAt>=touch.idleTime+60);
});
