import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {deformEar} from '../src/ears.mjs';import {Touch} from '../src/touch.mjs';
const rig=JSON.parse(readFileSync(new URL('../assets/rig.json',import.meta.url),'utf8'));
test('fast flick pins the ear root and stays a small flexible motion on both ears',()=>{
 for(const name of ['ear_l','ear_r']){const l=rig.layers.find(l=>l.name===name),side=name==='ear_l'?-1:1,tip=[l.pivot[0]+side*(l.box[2]-l.box[0])*.5,l.pivot[1]-50];let moved=false;
 for(let i=0;i<60;i++){const twitch={elapsed:i/240,count:2,period:.115,amplitude:1},s={[side<0?'earTwitchL':'earTwitchR']:twitch};assert.deepEqual(deformEar(...l.pivot,l,s),l.pivot);
 const p=deformEar(...tip,l,s);const d=Math.hypot(p[0]-tip[0],p[1]-tip[1]);moved||=d>2;assert.ok(d<Math.hypot(tip[0]-l.pivot[0],tip[1]-l.pivot[1])*.4);}
 assert.ok(moved);}
});
test('flick travels toward the tip, reverses briefly, and finishes quickly',()=>{
 const touch=new Touch(()=>.9);touch.twitch('l');let positive=0,negative=0;const l=rig.layers.find(l=>l.name==='ear_l'),dx=-(l.box[2]-l.box[0])*.5,dy=-50;
 for(let i=0;i<100;i++){const s=touch.step(1/240),q=deformEar(l.pivot[0]+dx,l.pivot[1]+dy,l,s),angle=dx*(q[1]-l.pivot[1])-dy*(q[0]-l.pivot[0]);if(angle>1)positive++;if(angle<-1)negative++;if(i===70)assert.equal(touch.ears.l,null);}
 assert.ok(positive&&negative,'ear briefly rebounds instead of holding a folded pose');assert.equal(touch.ears.r,null);
});
