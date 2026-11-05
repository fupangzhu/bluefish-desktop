import test from 'node:test';import assert from 'node:assert/strict';import {Preview,PREVIEWS} from '../src/preview.mjs';import {Motion} from '../src/motion.mjs';
test('every preview uses a deterministic shared motion timeline and reaches a valid end state',()=>{
 const m=new Motion(()=>.5),p=new Preview(m);for(const name of Object.keys(PREVIEWS)){p.select(name);p.seek(p.duration);assert.ok(m.current);for(const k of ['yaw','pitch','roll','left','right','sleep'])assert.ok(Number.isFinite(m.current[k]));if(['normal','rub_l','rub_r'].includes(name))assert.equal(m.current.sleeping,false);if(name==='peek')assert.ok(m.current.sleeping&&m.current.left===0&&m.current.right===0);}
});
test('left/right one-hand rubbing can be inspected and scrubbing reproduces the same pose',()=>{
 const m=new Motion(()=>.5),p=new Preview(m);for(const [name,hand] of [['rub_l',0],['rub_r',1]]){p.select(name);p.seek(2.5);const a={...m.current};assert.ok(a.rubEyes>.9);assert.equal(a.rubHand,hand);p.seek(.5);p.seek(2.5);for(const k of ['yaw','pitch','roll','left','right','rubEyes','rubHand'])assert.equal(m.current[k],a[k]);}
});
test('sleep ear previews isolate the requested ear and hair/breath can be inspected immediately',()=>{
 const m=new Motion(()=>.5),p=new Preview(m);for(const side of ['l','r']){p.select('ear_'+side);p.seek(.05);assert.ok(m.current[side==='l'?'earTwitchL':'earTwitchR']);assert.ok(m.current[side==='l'?'earTwitchR':'earTwitchL']==null);}
 p.select('breath');p.seek(5);assert.ok(m.current.breath>.0023);p.select('hair');p.seek(5);assert.ok(m.current.ahogeWag>1);
});
test('leaving a peek preview preserves the retry rule and restores natural random functions',()=>{
 const m=new Motion(()=>1),p=new Preview(m),random=m.wake.random;p.select('peek');p.seek(1);p.release();assert.equal(m.wake.random,random);m.attention.update(1/60,{now:1000,wake:true});m.step(1/60);assert.equal(m.current.sleeping,false);assert.notEqual(m.current.wakePreset,'peek');assert.throws(()=>p.select('missing'));
});

test('both ahoge side previews sweep between opposite poses and seeking reproduces the same side',()=>{
 const m=new Motion(()=>.5),p=new Preview(m);for(const [name,from] of [['hair_ltr',-1],['hair_rtl',1]]){p.select(name);p.seek(0);assert.equal(m.current.ahogeSide,from);p.seek(6.8);assert.ok(m.current.ahogeSide*-from>.95);const side=m.current.ahogeSide;p.seek(.8);p.seek(6.8);assert.equal(m.current.ahogeSide,side);}
});

test('waking from the left rest pose does not snap the strand to the right',()=>{const m=new Motion(()=>.5),p=new Preview(m);p.select('hair_rtl');p.seek(6.8);p.release();const side=m.current.ahogeSide;assert.ok(side<-.95);m.attention.update(1/60,{wake:true,now:1000});m.step(1/60);assert.ok(Math.abs(m.current.ahogeSide-side)<.01);});
