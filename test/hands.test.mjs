import test from 'node:test';import assert from 'node:assert/strict';import {eyeRubHands} from '../src/hands.mjs';
test('rubbing hands reach the projected eyes, retain their rest positions and never inherit walking taps',()=>{
 const size=240,cx=300,ledgeY=250,eyes=[{x:270,y:190},{x:320,y:205}],rest=[{x:12,lift:0,tap:1},{x:12,lift:2,tap:1}];
 const base={eyes,cx,ledgeY,size,phase:0};const low=eyeRubHands(rest,{...base,mix:0});assert.equal(low[0].x,12);assert.equal(low[1].lift,2);assert.equal(low[0].contact,0);
 const up=eyeRubHands(rest,{...base,mix:1});for(let i=0;i<2;i++){const x=cx+(i?1:-1)*.21*size+up[i].x,y=ledgeY-up[i].lift;assert.ok(Math.abs(x-eyes[i].x)<=size*.006+1e-9);assert.ok(Math.abs(y-eyes[i].y)<=size*.004+1e-9);assert.equal(up[i].tap,0);assert.equal(up[i].contact,1);}
 assert.equal(rest[0].tap,1);
});
