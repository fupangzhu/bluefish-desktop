import test from 'node:test';import assert from 'node:assert/strict';import {eyeFrame,EYE_STYLE} from '../src/eyes.mjs';
test('closed eyes expose no iris, preserve a curved stroke, and open without a texture switch',()=>{
 const closed=eyeFrame(0),open=eyeFrame(1);assert.equal(closed.iris,0);assert.equal(closed.upper,0);assert.equal(closed.lower,0);assert.equal(closed.line,1);assert.equal(open.iris,1);assert.equal(open.line,0);assert.ok(open.upper>1&&open.lower>1);assert.equal(EYE_STYLE.stroke,15);
 for(let i=0;i<1000;i++){const a=eyeFrame(i/1000),b=eyeFrame((i+1)/1000);for(const key of ['upper','lower','radius','line','iris','corner'])assert.ok(Math.abs(b[key]-a[key])<.04);}
});
test('half-open and narrow eyes meet at curved corners; the pupil is never rescaled',()=>{
 const half=eyeFrame(.5),narrow=eyeFrame(.2);assert.equal(half.upper,0);assert.equal(half.lower,eyeFrame(1).lower);assert.equal(half.corner,1);assert.equal(narrow.corner,1);assert.ok(narrow.lower<half.lower);assert.ok(narrow.line===1);
});

test('side glances use a clipped ellipse entirely under the lid instead of narrowing the iris into a shard',()=>{const a=eyeFrame(.5),b=eyeFrame(.5,1);assert.equal(a.sideEye,0);assert.equal(b.sideEye,1);assert.equal(a.radius,b.radius);assert.ok(b.curve<1&&b.gazeSpan>a.gazeSpan);assert.ok(.95*b.gazeSpan*2048+EYE_STYLE.glanceRadius<b.radius);assert.ok(EYE_STYLE.glanceDepth>.5);});
