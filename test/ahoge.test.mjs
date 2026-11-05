import test from 'node:test';
import assert from 'node:assert/strict';
import {AHOGE_DEGREE,AHOGE_REST,ahogeGeometry,ahogeWidth,ahogeSVG,ahogeEdges,bindAhoge,deformAhoge,solveAhoge} from '../src/ahoge.mjs';
import {Touch} from '../src/touch.mjs';
const near=(a,b,eps=.001)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<eps,JSON.stringify({a,b}));

test('material binding preserves the original curl including points off its centreline',()=>{
  for(const point of [{x:1143.222,y:503.018},{x:1410,y:117},{x:1560,y:265},{x:1460,y:365}])near(deformAhoge(bindAhoge(point),null),point);
});
test('the actual pinched material point follows the hand while the root remains fixed',()=>{
  const source={x:1535,y:280},target={x:1575,y:250},pose=solveAhoge(source,target);
  near(deformAhoge(bindAhoge(source),pose),target);
  for(let i=0;i<=pose.rootIndex;i++)near(deformAhoge(bindAhoge(AHOGE_REST[i]),pose),AHOGE_REST[i]);
  assert.ok(pose.stretch>=0&&pose.stretch<=.18);
});
test('extreme pulls retain the hooked tip, smooth attachment and bounded extension',()=>{
 const source=AHOGE_REST.at(-1),restTip={x:source.x-AHOGE_REST.at(-3).x,y:source.y-AHOGE_REST.at(-3).y};
 for(const [dx,dy] of [[0,-1e6],[1e6,0],[-1e6,0],[0,1e6]]){
  const pose=solveAhoge(source,{x:source.x+dx,y:source.y+dy});assert.ok(pose.saturated);assert.ok(pose.stretch<=.18);assert.ok(pose.curve.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  const tip={x:pose.curve.at(-1).x-pose.curve.at(-3).x,y:pose.curve.at(-1).y-pose.curve.at(-3).y};
  assert.ok((tip.x*restTip.x+tip.y*restTip.y)/(Math.hypot(tip.x,tip.y)*Math.hypot(restTip.x,restTip.y))>.99,'the hook must not straighten into a rod');
  for(let i=0;i<=pose.rootIndex;i++)near(pose.curve[i],AHOGE_REST[i]);
 }
});
test('the vector silhouette has a broad crown, smooth taper and a single material direction',()=>{
 assert.ok(ahogeWidth(.4)>25);assert.ok(ahogeWidth(.9)>8);assert.equal(ahogeWidth(1),0);assert.ok(ahogeSVG().includes('<path fill="url(#blue)"'));
 const points=ahogeGeometry();assert.ok(points.length>500);
 const source=AHOGE_REST[60];
 for(const [dx,dy] of [[0,-500],[500,0],[-500,0],[0,500]]){
  const pose=solveAhoge(source,{x:source.x+dx,y:source.y+dy});
  for(let i=0;i<points.length;i+=3){
   const src=points.slice(i,i+3),dst=src.map(p=>deformAhoge(p[4],pose)),cross=ps=>(ps[1].x-ps[0].x)*(ps[2].y-ps[0].y)-(ps[1].y-ps[0].y)*(ps[2].x-ps[0].x),a=cross(src.map(p=>({x:p[0],y:p[1]}))),b=cross(dst);
   if(Math.abs(a)>1)assert.ok(a*b>0,'a visible triangle must never flip inside out');
  }
 }
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

test('each boundary uses three quadratic segments with continuous tangents',()=>{
 const svg=ahogeSVG();assert.equal(AHOGE_DEGREE,2);assert.equal((svg.match(/Q[0-9]/g)||[]).length,6);assert.equal((svg.match(/C[0-9]/g)||[]).length,0);assert.equal((svg.match(/L[0-9]/g)||[]).length,0);
 const h=.0001;
 for(const k of [1/3,2/3])for(const side of [0,1]){
  const p=ahogeEdges(k)[side],a=ahogeEdges(k-h)[side],b=ahogeEdges(k-2*h)[side],c=ahogeEdges(k+h)[side],d=ahogeEdges(k+2*h)[side];
  assert.ok(Math.hypot((p.x-a.x)-(c.x-p.x),(p.y-a.y)-(c.y-p.y))/h<2);
 }
});
test('boundary grabs retain their material coordinate across the width of the spline',()=>{
 const p=ahogeGeometry()[540],source={x:p[0],y:p[1]},target={x:source.x+14,y:source.y-12},pose=solveAhoge(source,target,{binding:p[4]});assert.equal(pose.saturated,false);near(deformAhoge(p[4],pose),target);
});

test('the moving quadratic outline stays closed at the tip and tangent-continuous at its knots',()=>{
 const source=AHOGE_REST[60],h=.0001;
 for(const [dx,dy] of [[0,-500],[500,0],[-500,0],[0,500]]){
  const pose=solveAhoge(source,{x:source.x+dx,y:source.y+dy});near(deformAhoge({t:79,u:0},pose),deformAhoge({t:79,u:1},pose),1e-5);
  for(const side of [0,1])for(const k of [1/3,2/3]){
   const at=t=>deformAhoge({t:t*79,u:side},pose),p=at(k),a=at(k-h),b=at(k-2*h),c=at(k+h),d=at(k+2*h),l={x:(p.x-2*a.x+b.x)/(h*h),y:(p.y-2*a.y+b.y)/(h*h)},r={x:(d.x-2*c.x+p.x)/(h*h),y:(d.y-2*c.y+p.y)/(h*h)};
   assert.ok(Math.hypot((p.x-a.x)-(c.x-p.x),(p.y-a.y)-(c.y-p.y))/h<2);
  }
 }
});

test('side changes use root rotation through upright, never a collapsing mirror scale',async()=>{const {ahogeRestAngle}=await import('../src/ahoge.mjs');assert.equal(ahogeRestAngle(1,-1),-115);assert.equal(ahogeRestAngle(1,1),75);assert.equal(ahogeRestAngle(0,-1),0);for(let i=0;i<100;i++){const a=ahogeRestAngle(1,-1+i/50),b=ahogeRestAngle(1,-1+(i+1)/50);assert.ok(Math.abs(b-a)<2);}});

test('SVG quadratic segments reproduce the same WebGL boundary between their endpoints',()=>{
 const svg=ahogeSVG(),path=svg.match(/ d="([^"]+)"/)[1],tokens=path.match(/[MQZ]|-?\d+(?:\.\d+)?/g);let i=1,point={x:+tokens[i++],y:+tokens[i++]},segment=0;
 while(tokens[i]==='Q'){i++;const control={x:+tokens[i++],y:+tokens[i++]},end={x:+tokens[i++],y:+tokens[i++]};for(const u of [.15,.4,.7,.9]){const v=1-u,p={x:v*v*point.x+2*v*u*control.x+u*u*end.x,y:v*v*point.y+2*v*u*control.y+u*u*end.y},side=segment<3?0:1,t=segment<3?(segment+u)/3:(6-segment-u)/3;near(p,ahogeEdges(t)[side],.0002);}point=end;segment++;}assert.equal(segment,6);
});
