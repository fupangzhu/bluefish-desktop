import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Motion} from '../src/motion.mjs';
import {Peek} from '../src/peek.mjs';
import {Renderer} from '../src/renderer.mjs';
const rig=JSON.parse(readFileSync(new URL('../assets/rig.json',import.meta.url),'utf8'));
const advance=(m,seconds)=>{for(let i=0;i<Math.ceil(seconds*60);i++)m.step(1/60);return m.current;};
const projected=(name,point,patch)=>Renderer.prototype.project.call({rig},...point,{yaw:0,pitch:0,roll:0,hair:0,time:0,...patch},rig.layers.find(l=>l.name===name));

test('sulking and returning home lower the ears smoothly with the existing mood signal',()=>{
  const m=new Motion(()=>.5),p=new Peek();m.idle=false;
  assert.equal(m.step(0).earMood,0);
  m.override={droop:.4};assert.ok(advance(m,.8).earMood<-.3&&m.current.earMood>-.4);
  p.forceSulk();m.override=p.snapshot().override;
  const first=m.step(1/60).earMood;assert.ok(first>-.5);
  assert.ok(advance(m,1).earMood<-.95);
});
test('attention perks the ears slightly and the happy gesture settles back to neutral',()=>{
  const m=new Motion(()=>.5),p=new Peek();m.idle=false;p.forceSulk();m.override=p.snapshot().override;advance(m,1.2);
  const out=p.update(1/60,{poke:true,near:true});assert.equal(out.gesture,'happy');
  m.override=out.override;m.gesture(out.gesture);
  assert.ok(m.step(1/60).earMood<0,'transition starts from the current droop');
  assert.ok(advance(m,.85).earMood>.85);assert.ok(m.current.earMood<=1);
  assert.ok(Math.abs(advance(m,3).earMood)<.001);
});
test('reduced motion keeps static mood poses, and reset restores neutral ears',()=>{
  const m=new Motion(()=>.5);m.reduced=true;m.override={droop:1};assert.equal(m.step(.1).earMood,-1);
  m.override=null;m.gesture('happy');assert.ok(advance(m,.8).earMood>.9);
  m.reset();assert.equal(m.step(0).earMood,0);
});
test('both ear tips droop downward, perk upward modestly, and keep their roots attached',()=>{
  for(const [name,tip] of [['ear_l',[365,350]],['ear_r',[1920,870]]]){
    const layer=rig.layers.find(l=>l.name===name),rest=projected(name,tip,{}),droop=projected(name,tip,{earMood:-1}),perk=projected(name,tip,{earMood:1});
    assert.ok(droop[1]<rest[1]-.03,'droop moves toward the bottom of the screen');
    assert.ok(perk[1]>rest[1]&&perk[1]-rest[1]<.06,'excited lift is deliberately small');
    assert.deepEqual(projected(name,layer.pivot,{earMood:-1}),projected(name,layer.pivot,{}));
    assert.deepEqual(projected(name,layer.pivot,{earMood:1}),projected(name,layer.pivot,{}));
  }
});
test('click and idle folds compose with the mood without disturbing the other ear or face',()=>{
  const tip=[365,350],right=[1920,870],mood={earMood:-.7};
  assert.notDeepEqual(projected('ear_l',tip,{...mood,earFoldL:1}),projected('ear_l',tip,mood));
  assert.deepEqual(projected('ear_r',right,{...mood,earFoldL:1}),projected('ear_r',right,mood));
  assert.deepEqual(projected('face',[963,1306],{earMood:1}),projected('face',[963,1306],{}));
  for(const earMood of [-1,0,1])for(const earFoldL of [0,.38,1])assert.ok(projected('ear_l',tip,{earMood,earFoldL}).every(Number.isFinite));
});
