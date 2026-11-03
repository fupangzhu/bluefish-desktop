import test from 'node:test';
import assert from 'node:assert/strict';
import {Touch,TouchInput} from '../src/touch.mjs';
import {Motion} from '../src/motion.mjs';

const advance=(touch,seconds,reduced=false)=>{let state;for(let i=0;i<Math.ceil(seconds*120);i++)state=touch.step(1/120,reduced);return state;};

test('ahoge needs a tug, stays painful while held, and recovers after release',()=>{
  const touch=new Touch();touch.startPull({x:80,y:60});
  assert.equal(advance(touch,.3).pain,0);
  touch.movePull({x:81,y:59},240);assert.equal(advance(touch,.1).pain,0);
  touch.movePull({x:100,y:5},240);
  const held=advance(touch,1);assert.ok(held.pain>.99);assert.ok(held.ahogePullY<0);
  assert.ok(Math.abs(held.ahogePullX)<=.12&&Math.abs(held.ahogePullY)<=.12);
  assert.ok(advance(touch,2).pain>.99);
  touch.endPull();const released=advance(touch,.7);
  assert.equal(released.pain,0);assert.equal(released.ahogePullX,0);assert.equal(released.ahogePullY,0);
});

test('pull amount is independent of avatar size and bounded at extreme pointer positions',()=>{
  const samples=[150,240,460].map(size=>{const touch=new Touch();touch.startPull({x:0,y:0});touch.movePull({x:size*.08,y:-size*.09},size);return advance(touch,.5);});
  for(const sample of samples)for(const key of Object.keys(sample))assert.ok(Math.abs(sample[key]-samples[0][key])<1e-10);
  const touch=new Touch();touch.startPull({x:0,y:0});touch.movePull({x:1e6,y:-1e6},150);touch.movePull({x:NaN,y:0},150);
  const state=advance(touch,.5);assert.ok(Object.values(state).every(Number.isFinite));assert.ok(state.pain<=1);assert.ok(state.ahogePullX<=.12&&state.ahogePullY>=-.09);
});

test('ear taps randomly produce exactly one or two folds on the selected side',()=>{
  for(const side of ['l','r'])for(const [random,expected] of [[0,1],[.9,2]]){
    const touch=new Touch(()=>random);assert.equal(touch.twitch(side),expected);
    let pulses=0,folded=false;
    for(let i=0;i<100;i++){
      const state=touch.step(1/120),fold=state[side==='l'?'earFoldL':'earFoldR'];
      assert.equal(state[side==='l'?'earFoldR':'earFoldL'],0);
      if(fold>.5&&!folded)pulses++;folded=fold>.5;
      assert.ok(fold>=0&&fold<=1);
    }
    assert.equal(pulses,expected);assert.equal(touch.ears[side],null);
  }
});

test('independent ears can overlap, repeated clicks restart, reduced motion avoids rapid folds',()=>{
  const touch=new Touch(()=>.9);touch.twitch('l');advance(touch,.08);touch.twitch('r');
  const both=touch.step(1/120);assert.ok(both.earFoldL>0&&both.earFoldR>0);
  touch.twitch('l');assert.ok(touch.step(1/120).earFoldL<.2);
  let max=0;for(let i=0;i<60;i++){const s=touch.step(1/120,true);max=Math.max(max,s.earFoldL,s.earFoldR);}
  assert.ok(max<=.22);assert.equal(touch.ears.l,null);assert.equal(touch.ears.r,null);
});

test('ahoge dragging never requests a native drag; cancellation releases the expression',()=>{
  const touch=new Touch(),drags=[],input=new TouchInput(touch,on=>drags.push(on));
  input.begin('ahoge',{x:100,y:100},240);input.move({x:100,y:40});
  assert.ok(advance(touch,.2).pain>.9);assert.deepEqual(drags,[]);
  input.end(true);assert.equal(advance(touch,.7).pain,0);assert.equal(input.active,null);
});

test('ear click reacts only on release; ear drag and cancelled input never twitch',()=>{
  const touch=new Touch(()=>0),drags=[],input=new TouchInput(touch,on=>drags.push(on));
  input.begin('ear_l',{x:100,y:100},240);assert.equal(touch.ears.l,null);
  input.move({x:102,y:101});input.end();assert.ok(touch.ears.l);assert.deepEqual(drags,[]);
  touch.reset();input.begin('ear_r',{x:100,y:100},240);input.move({x:120,y:100});input.end();
  assert.deepEqual(drags,[true,false]);assert.equal(touch.ears.r,null);
  input.begin('ear_l',{x:0,y:0},240);input.end(true);assert.equal(touch.ears.l,null);
});

test('body drag still works and reset clears every reaction even with idle/follow disabled',()=>{
  const m=new Motion(()=>.9);m.idle=false;m.follow=false;
  const drags=[],input=new TouchInput(m.touch,on=>drags.push(on));input.begin(null,{x:0,y:0},240);input.end();assert.deepEqual(drags,[true,false]);
  m.touch.startPull({x:0,y:0});m.touch.movePull({x:0,y:-50},240);m.touch.twitch('r');
  for(let i=0;i<12;i++)m.step(1/60);assert.ok(m.current.pain>.99);
  m.reset();const state=m.step(1/60);for(const key of ['pain','ahogePullX','ahogePullY','earFoldL','earFoldR'])assert.equal(state[key],0);
});
