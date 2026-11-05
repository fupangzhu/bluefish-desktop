import test from 'node:test';import assert from 'node:assert/strict';
import {Reluctance,RELUCTANCE} from '../src/reluctance.mjs';import {Motion} from '../src/motion.mjs';import {Preview} from '../src/preview.mjs';
const point={x:170,y:100,size:240,near:true,overHead:false,hx:.7,hy:0};
test('a droop recovery rolls once at the 30% boundary, not on every nearby mouse tick',()=>{
 for(const [draw,expected] of [[0,true],[.299999,true],[.3,false],[.99,false]]){
  let draws=0;const r=new Reluctance(()=>{draws++;return draw;});r.update(.1,{droop:1});assert.equal(draws,0);r.update(.1,{droop:1,active:true,hx:1});assert.equal(r.active,expected);
  for(let i=0;i<290;i++)r.update(.1,{droop:1,active:i%2===0,hx:-1});assert.equal(draws,1);
 }
});
test('glance locks the opposite side, shares the head shift, and returns continuously to zero',()=>{
 for(const hx of [-1,1])for(const fps of [30,60,120]){
  const r=new Reluctance(()=>0),dt=1/fps;r.update(dt,{droop:1});r.update(dt,{active:true,hx});let peak=0,lastShift=0;
  for(let i=0;i<fps*4;i++){const s=r.update(dt,{active:true,hx:-hx});assert.ok(Math.abs(s.shiftX-lastShift)<.003);lastShift=s.shiftX;if(s.mix>.9){assert.equal(Math.sign(s.gx),-hx);if(r.elapsed>.4)assert.equal(Math.sign(s.shiftX),-hx);assert.ok(s.eyeCap<=.55);}peak=Math.max(peak,Math.abs(s.shiftX));}
  assert.ok(Math.abs(peak-RELUCTANCE.shift)<1e-8);assert.equal(r.active,false);assert.equal(r.sample().shiftX,0);
 }
 const r=new Reluctance(()=>0);r.update(0,{droop:1});assert.equal(r.update(0,{active:true,hx:0,innerSide:1}).gx,.95);
});
test('sleeping, direct manipulation, disabled following and reduced motion never select a snub',()=>{
 for(const opt of [{eligible:false},{enabled:false}]){let count=0;const r=new Reluctance(()=>{count++;return 0;});r.update(.1,{droop:1});r.update(.1,{droop:1,active:true,...opt});assert.equal(r.active,false);assert.equal(count,0);}
 for(const opt of [{blocked:true},{follow:false},{reduced:true}]){const m=new Motion(()=>0);m.attention.droop=1;m.attention.update(0,{});m.attention.update(.1,{...point,...opt});m.step(.1);assert.equal(m.current.reluctant,false);}
 const m=new Motion(()=>0);m.attention.sleepController.sleeping=true;m.attention.sleepController.depth=m.attention.sleepController.closure=1;m.attention.update(.1,{...point});m.step(.1);assert.equal(m.current.sleeping,true);assert.equal(m.current.reluctant,false);
});
test('normal restoration keeps normal gaze; rare restoration gives the opposite gaze and releases travel',()=>{
 for(const [draw,expected] of [[0,true],[.8,false]]){
  const m=new Motion(()=>draw);m.idle=false;m.setGaze(.8,0);
  for(let i=0;i<1500;i++){m.attention.update(1/60,{});m.step(1/60);}assert.ok(m.attention.current.droop>.98);
  for(let i=0;i<75;i++){m.attention.update(1/60,{...point,x:point.x+i});m.step(1/60);}
  assert.equal(m.current.reluctant,expected);assert.equal(m.blocksTravel(),expected);assert.ok(expected?m.current.gx<-.85:m.current.gx>.75);assert.ok(expected?m.current.shiftX<-.024:m.current.shiftX===0);
  for(let i=0;i<300;i++){m.attention.update(1/60,{...point,x:point.x+i});m.step(1/60);}assert.equal(m.current.reluctant,false);assert.equal(m.blocksTravel(),false);assert.ok(m.current.gx>.75);
 }
});
test('both editor snub previews are deterministic, target the requested side and restore controller randomness',()=>{
 const m=new Motion(()=>.5),p=new Preview(m),random=m.attention.reluctance.random;for(const [name,dir] of [['snub_l',-1],['snub_r',1]]){p.select(name);p.seek(1.2);assert.equal(m.current.reluctant,true);assert.equal(Math.sign(m.current.gx),dir);assert.equal(Math.sign(m.current.shiftX),dir);assert.ok(m.current.sideEye>.99&&m.current.left===.5);const x=m.current.shiftX,g=m.current.gx;p.seek(.1);p.seek(1.2);assert.equal(m.current.shiftX,x);assert.equal(m.current.gx,g);}p.release();assert.equal(m.attention.reluctance.random,random);
});
