import test from 'node:test';
import assert from 'node:assert/strict';
import dock from '../desktop/dock.cjs';
const display={x:0,y:0,width:1920,height:1080},work={x:0,y:0,width:1920,height:1040};

test('clampSize clamps to 150-460, rounds and defaults invalid input to 240',()=>{
  assert.equal(dock.clampSize(100),150);assert.equal(dock.clampSize(999),460);assert.equal(dock.clampSize(300.4),300);
  for(const bad of [undefined,null,NaN,'abc','300',{},Infinity])assert.equal(dock.clampSize(bad),240);
});
test('layout: docked and free geometry',()=>{
  assert.deepEqual(dock.layout(240,true),{width:312,height:180,grip:12});
  assert.deepEqual(dock.layout(150,true),{width:195,height:113,grip:8});
  assert.deepEqual(dock.layout(460,true),{width:598,height:345,grip:23});
  assert.deepEqual(dock.layout(240,false),{width:240,height:240,grip:0});
  assert.deepEqual(dock.layout(9999,false),{width:460,height:460,grip:0});
});
test('dockedBounds overlaps the taskbar by grip and clamps horizontally',()=>{
  const b=dock.dockedBounds(work,display,240,500);
  assert.deepEqual(b,{x:344,y:1040+12-180,width:312,height:180});
  assert.equal(b.y+b.height,work.y+work.height+12);
  assert.equal(dock.dockedBounds(work,display,240,-500).x,0);
  assert.equal(dock.dockedBounds(work,display,240,99999).x,1920-312);
});
test('dockedBounds respects a non-zero display origin',()=>{
  const d2={x:1920,y:0,width:1280,height:1024},w2={x:1920,y:0,width:1280,height:984};
  const b=dock.dockedBounds(w2,d2,300,1920+100);
  assert.equal(b.x,1920);assert.equal(b.y+b.height,984+15);
});
test('freeBounds is a square clamped inside the work area',()=>{
  assert.deepEqual(dock.freeBounds(work,240,{x:500,y:500}),{x:380,y:380,width:240,height:240});
  assert.deepEqual(dock.freeBounds(work,240,{x:-50,y:-50}),{x:0,y:0,width:240,height:240});
  const b=dock.freeBounds(work,240,{x:99999,y:99999});
  assert.equal(b.x+b.width,1920);assert.equal(b.y+b.height,1040);
});
test('homeCenterX is 20% across the work area',()=>{
  assert.equal(dock.homeCenterX(work),384);
  assert.equal(dock.homeCenterX({x:100,y:0,width:1000,height:500}),300);
});
test('shouldUndock needs an upward pull of max(60, size*0.35)',()=>{
  assert.equal(dock.shouldUndock(-59,150),false);assert.equal(dock.shouldUndock(-61,150),true);
  assert.equal(dock.shouldUndock(-100,460),false);assert.equal(dock.shouldUndock(-162,460),true);
  assert.equal(dock.shouldUndock(80,240),false);assert.equal(dock.shouldUndock(0,240),false);
});
test('shouldDock when the bottom edge is within 24px of (or below) the work-area bottom',()=>{
  const at=bottom=>({x:0,y:bottom-240,width:240,height:240});
  assert.equal(dock.shouldDock(at(1040),work),true);assert.equal(dock.shouldDock(at(1017),work),true);
  assert.equal(dock.shouldDock(at(1016),work),false);assert.equal(dock.shouldDock(at(500),work),false);
  assert.equal(dock.shouldDock(at(1060),work),true);
});
test('resizing keeps the docked bottom edge and center x, and the free center',()=>{
  const small=dock.dockedBounds(work,display,150,800),cx=small.x+small.width/2;
  const big=dock.dockedBounds(work,display,460,cx);
  assert.equal(big.y+big.height,small.y+small.height-dock.layout(150,true).grip+dock.layout(460,true).grip);
  assert.ok(Math.abs(big.x+big.width/2-cx)<=1);
  const f1=dock.freeBounds(work,200,{x:700,y:600}),c={x:f1.x+f1.width/2,y:f1.y+f1.height/2};
  const f2=dock.freeBounds(work,400,c);
  assert.deepEqual({x:f2.x+f2.width/2,y:f2.y+f2.height/2},c);
});
test('popupPosition opens at the point, flips up/left and clamps inside the work area',()=>{
  const sz={width:280,height:400};
  assert.deepEqual(dock.popupPosition({x:100,y:100},sz,work),{x:100,y:100,width:280,height:400});
  assert.deepEqual(dock.popupPosition({x:1900,y:1000},sz,work),{x:1620,y:600,width:280,height:400});
  const tiny={x:0,y:0,width:300,height:300};
  assert.deepEqual(dock.popupPosition({x:290,y:290},sz,tiny),{x:10,y:0,width:280,height:400});
});
