import test from 'node:test';import assert from 'node:assert/strict';import {eyeRubHands} from '../src/hands.mjs';import {Wake} from '../src/wake.mjs';
test('only the selected hand reaches its eye, while the other rests on the ledge',()=>{
 const size=240,cx=300,ledgeY=250,eyes=[{x:270,y:190},{x:320,y:205}],rest=[{x:12,lift:0,tap:1},{x:12,lift:2,tap:1}];
 for(const hand of [0,1]){const up=eyeRubHands(rest,{eyes,cx,ledgeY,size,phase:0,mix:1,hand});for(let i=0;i<2;i++){assert.equal(up[i].tap,0);if(i===hand){const x=cx+(i?1:-1)*.21*size+up[i].x,y=ledgeY-up[i].lift;assert.ok(Math.abs(x-eyes[i].x)<=size*.006+1e-9);assert.ok(Math.abs(y-eyes[i].y)<=size*.004+1e-9);assert.equal(up[i].contact,1);}else{assert.equal(up[i].lift,0);assert.equal(up[i].x,rest[i].x);assert.equal(up[i].contact,0);}}}
 assert.equal(rest[0].tap,1);
});
test('one wake draw picks a stable rubbing hand for the complete action',()=>{
 for(const [draw,hand] of [[.66,0],[.8,1]]){let calls=0;const w=new Wake(()=>{calls++;return draw;});assert.equal(w.request(0),true);assert.equal(w.preset,'rubeyes');for(let i=0;i<250;i++){const s=w.step(1/60);assert.equal(s.rubHand,hand);}assert.equal(calls,1);}
});
