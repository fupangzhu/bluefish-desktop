import test from 'node:test';import assert from 'node:assert/strict';import {Eyelids} from '../src/eyelids.mjs';
const draws=values=>()=>{assert.ok(values.length,'unexpected random draw');return values.shift();};

test('most closures are synchronous, with an occasional independent stagger',()=>{
 let seed=12345;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
 const e=new Eyelids(random);let syncBlink=0,syncRub=0;
 for(let i=0;i<1000;i++){
  e.blink(i);if(e.blinkLag===0)syncBlink++;
  e.sample(i,{rub:0});e.sample(i+.1,{rub:1});if(e.rubLag===0)syncRub++;
 }
 assert.ok(syncBlink>750&&syncBlink<850);assert.ok(syncRub>750&&syncRub<850);
 const same=new Eyelids(()=>.1);same.blink(0);
 for(let i=0;i<100;i++){const s=same.sample(i/100,{rub:1,eyeCap:1-i/100});assert.equal(s.left,s.right);}
});

test('occasional blinks use either lead eye, only 10–25ms apart, then reopen together',()=>{
 const e=new Eyelids(draws([.9,.1,0,.9,.9,1]));e.blink(0);let s=e.sample(.13);assert.ok(s.left<s.right);assert.equal(e.blinkLag,.010);assert.deepEqual(e.sample(.5),{left:1,right:1});
 e.blink(1);s=e.sample(1.13);assert.ok(s.right<s.left);assert.equal(e.blinkLag,.025);assert.deepEqual(e.sample(1.5),{left:1,right:1});
});

test('occasional slow petting closures use either order, only 25–65ms apart',()=>{
 for(const [order,lead,lag] of [[.1,'left',0],[.9,'right',1]]){
  const e=new Eyelids(draws([.9,order,lag])),closed={};let s;
  for(let i=0;i<3000;i++){const t=i/1000,cap=Math.max(0,1-t/2);s=e.sample(t,{rub:1,eyeCap:cap});for(const side of ['left','right'])if(s[side]<.02&&closed[side]===undefined)closed[side]=t;}
  const trail=lead==='left'?'right':'left',gap=closed[trail]-closed[lead];assert.ok(gap>=.024&&gap<=.066);assert.deepEqual(s,{left:0,right:0});assert.deepEqual(e.sample(3.1,{rub:0,eyeCap:1}),{left:1,right:1});
 }
});

test('timing is chosen once per rub, and can switch from staggered to synchronous',()=>{
 const values=[.9,.1,.5,.1],e=new Eyelids(draws(values));
 for(let i=0;i<120;i++)e.sample(i/120,{rub:1,eyeCap:.6});assert.equal(values.length,1);assert.equal(e.rubLead,'l');assert.ok(e.rubLag>0);
 e.sample(1,{rub:0,eyeCap:1});e.sample(1.1,{rub:1,eyeCap:.5});assert.equal(values.length,0);assert.equal(e.rubLag,0);
});

test('reopening and reset clear closed eyes and timing history remains bounded',()=>{
 const e=new Eyelids(()=>.5);for(let i=0;i<7200;i++)e.sample(i/120,{rub:1,eyeCap:0});assert.ok(e.history.length<80);assert.deepEqual(e.sample(60.1,{rub:1,eyeCap:1}),{left:1,right:1});e.reset();assert.deepEqual(e.sample(61),{left:1,right:1});
});
