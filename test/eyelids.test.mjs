import test from 'node:test';import assert from 'node:assert/strict';import {Eyelids} from '../src/eyelids.mjs';
test('each blink chooses a fresh lead eye and finishes with both eyes open',()=>{
 const draws=[.1,.4,.9,.6],e=new Eyelids(()=>draws.shift());e.blink(0);let s=e.sample(.13);assert.ok(s.left<s.right);assert.deepEqual(e.sample(.5),{left:1,right:1});
 e.blink(1);s=e.sample(1.13);assert.ok(s.right<s.left);assert.deepEqual(e.sample(1.5),{left:1,right:1});assert.equal(draws.length,0);
});
test('slow petting closure supports either order with a visible delay',()=>{
 for(const [random,lead] of [[.1,'left'],[.9,'right']]){
  const e=new Eyelids(()=>random),closed={};let s;
  for(let i=0;i<360;i++){const t=i/120,cap=Math.max(0,1-t/2);s=e.sample(t,{rub:1,eyeCap:cap});for(const side of ['left','right'])if(s[side]<.02&&closed[side]===undefined)closed[side]=t;}
  const trail=lead==='left'?'right':'left';assert.ok(closed[lead]<closed[trail]-.08);assert.deepEqual(s,{left:0,right:0});assert.deepEqual(e.sample(3.1,{rub:0,eyeCap:1}),{left:1,right:1});
 }
});
test('lead order is stable during a rub and reselected on the next rub',()=>{
 let calls=0;const e=new Eyelids(()=>{calls++;return calls<3?.1:.9;});
 for(let i=0;i<120;i++)e.sample(i/120,{rub:1,eyeCap:.6});assert.equal(calls,2);assert.equal(e.rubLead,'l');
 e.sample(1,{rub:0,eyeCap:1});e.sample(1.1,{rub:1,eyeCap:.5});assert.equal(calls,4);assert.equal(e.rubLead,'r');
});
test('reopening and reset clear closed eyes and timing history remains bounded',()=>{
 const e=new Eyelids(()=>.5);for(let i=0;i<7200;i++)e.sample(i/120,{rub:1,eyeCap:0});assert.ok(e.history.length<80);assert.deepEqual(e.sample(60.1,{rub:1,eyeCap:1}),{left:1,right:1});e.reset();assert.deepEqual(e.sample(61),{left:1,right:1});
});
