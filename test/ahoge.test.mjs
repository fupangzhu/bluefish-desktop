import test from 'node:test';
import assert from 'node:assert/strict';
import {AHOGE_DEGREE,AHOGE_REST,AHOGE_ROOT,TAUT,ahogeReach,ahogeGeometry,ahogeWidth,ahogeSVG,ahogeEdges,bindAhoge,deformAhoge,reboundAhoge,solveAhoge} from '../src/ahoge.mjs';
import {Touch} from '../src/touch.mjs';
const near=(a,b,eps=.001)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<eps,JSON.stringify({a,b}));

test('material binding preserves the original curl including points off its centreline',()=>{
  for(const point of [{x:1143.222,y:503.018},{x:1410,y:117},{x:1560,y:265},{x:1460,y:365}])near(deformAhoge(bindAhoge(point),null),point);
});
test('the actual pinched material point follows the hand while the root remains fixed',()=>{
  const source={x:1535,y:280},target={x:1575,y:250},pose=solveAhoge(source,target);
  near(deformAhoge(bindAhoge(source),pose),target);
  near(deformAhoge(bindAhoge(AHOGE_REST[0]),pose),AHOGE_REST[0]);
  assert.ok(pose.stretch>=0&&pose.stretch<=.18);
});
test('extreme pulls straighten the strand toward the pointer, root fixed and length bounded',()=>{
 const source=AHOGE_REST.at(-1),rest=solveAhoge(source,source);
 assert.equal(rest.taut,0);assert.equal(rest.phase,'bend');
 for(const [dx,dy] of [[0,-1e6],[1e6,0],[-1e6,0],[0,1e6]]){
  const pose=solveAhoge(source,{x:source.x+dx,y:source.y+dy});assert.ok(pose.saturated);assert.equal(pose.phase,'resist');assert.equal(pose.taut,1);
  assert.ok(pose.stretch<=TAUT.max-1+1e-9);assert.ok(pose.outline.flat().every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  // A straight line from the fixed root: the tip points at the pull.
  const mid=j=>({x:(pose.outline[0][j].x+pose.outline[1][j].x)/2,y:(pose.outline[0][j].y+pose.outline[1][j].y)/2}),root=mid(0),tip=mid(4),dir=Math.hypot(dx,dy);
  near(root,AHOGE_ROOT,1);assert.ok(((tip.x-root.x)*dx+(tip.y-root.y)*dy)/dir/Math.hypot(tip.x-root.x,tip.y-root.y)>.99);
 }
});
test('pulling away from the root bends, then straightens, then holds a taut strand under the pointer',()=>{
 const source={x:1535,y:280},binding=bindAhoge(source),reach=ahogeReach(binding),phases=[];
 for(let k=0;k<=.42;k+=.02){
  const target={x:source.x+k*1000,y:source.y},pose=solveAhoge(source,target,{binding});phases.push(pose.phase);
  if(pose.phase==='taut'){const pin=deformAhoge(binding,pose);assert.ok(Math.hypot(pin.x-target.x,pin.y-target.y)<1,'the pinch stays under the pointer');}
 }
 assert.ok(reach.arc>Math.hypot(reach.x,reach.y),'the curl is longer than its chord');
 const order=['bend','straighten','taut','resist'],seen=[...new Set(phases)];
 assert.deepEqual(seen,order,'phases in order: '+phases.join(','));
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
  const binding={t:32.75,u:.12},pin=deformAhoge(binding,pose);
  const again=solveAhoge(source,pin,{baseOutline:pose.outline,binding});assert.deepEqual(again.outline,pose.outline);
  assert.deepEqual(reboundAhoge(pose,1).outline,pose.outline);
  assert.ok(reboundAhoge(pose,-.1).outline.flat().every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
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

test('side changes use the lower root arc, never a collapsing mirror scale',async()=>{const {ahogeRestAngle}=await import('../src/ahoge.mjs');assert.equal(ahogeRestAngle(1,-1),245);assert.equal(ahogeRestAngle(1,1),75);assert.equal(ahogeRestAngle(0,-1),0);for(let i=0;i<100;i++){const a=ahogeRestAngle(1,-1+i/50),b=ahogeRestAngle(1,-1+(i+1)/50);assert.ok(Math.abs(b-a)<2);}});

test('SVG quadratic segments reproduce the same WebGL boundary between their endpoints',()=>{
 const svg=ahogeSVG(),path=svg.match(/ d="([^"]+)"/)[1],tokens=path.match(/[MQZ]|-?\d+(?:\.\d+)?/g);let i=1,point={x:+tokens[i++],y:+tokens[i++]},segment=0;
 while(tokens[i]==='Q'){i++;const control={x:+tokens[i++],y:+tokens[i++]},end={x:+tokens[i++],y:+tokens[i++]};for(const u of [.15,.4,.7,.9]){const v=1-u,p={x:v*v*point.x+2*v*u*control.x+u*u*end.x,y:v*v*point.y+2*v*u*control.y+u*u*end.y},side=segment<3?0:1,t=segment<3?(segment+u)/3:(6-segment-u)/3;near(p,ahogeEdges(t)[side],.0002);}point=end;segment++;}assert.equal(segment,6);
});

test('an oblique pull on the edge near the root resists instead of folding the visible ribbon',()=>{
 const p=ahogeGeometry()[13*6+1],source={x:p[0],y:p[1]},target={x:source.x-240,y:source.y+240*Math.sqrt(3)};
 const pose=solveAhoge(source,target,{binding:p[4]});
 assert.ok(pose.saturated);
 for(const u of [0,1]){
  const points=Array.from({length:97},(_,i)=>deformAhoge({t:i/96*79,u},pose));
  for(let i=1;i<96;i++){
   const a={x:points[i].x-points[i-1].x,y:points[i].y-points[i-1].y},b={x:points[i+1].x-points[i].x,y:points[i+1].y-points[i].y};
   assert.ok(Math.abs(Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y))<.13,'visible contour turns without a local fold');
  }
 }
});
test('a slipped, fully straightened strand springs back to its curl without snapping or coiling into a spiral',()=>{
 const source={x:1535,y:280},binding=bindAhoge(source),curl=outline=>{
  const P=Array.from({length:81},(_,i)=>deformAhoge({t:i*(AHOGE_REST.length-1)/80,u:.5},{outline}));let total=0;
  for(let i=2;i<P.length;i++){const a={x:P[i-1].x-P[i-2].x,y:P[i-1].y-P[i-2].y},c={x:P[i].x-P[i-1].x,y:P[i].y-P[i-1].y};total+=Math.atan2(a.x*c.y-a.y*c.x,a.x*c.x+a.y*c.y);}
  return total*180/Math.PI;
 };
 const rest=curl(solveAhoge(source,source,{binding}).outline);
 for(const target of [{x:source.x-150,y:source.y-700},{x:source.x+700,y:source.y},{x:source.x+300,y:source.y-600}]){
  const straight=solveAhoge(source,target,{binding});
  assert.equal(straight.taut,1);assert.ok(Math.abs(curl(straight.outline))<5);
  let last=-Infinity;
  for(let f=1;f>=-.6;f-=.05){const pose=reboundAhoge(straight,f),turn=curl(pose.outline);
   assert.ok(turn<=rest+10,'never coils past its curl: '+f.toFixed(2)+' -> '+turn.toFixed(1));
   if(f>=0){assert.ok(turn>=last-1,'recurls steadily, no snap or loop: '+f.toFixed(2));last=turn;}
   assert.ok(pose.outline.flat().every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));}
  near(deformAhoge(binding,reboundAhoge(straight,0)),source);
 }
});
