// Golden recorder for the editor previews: every preview, seeked to a few times, recording the
// pose the renderer would draw. tests/preview_golden.rs replays them on the Rust port.
// Run: node native/golden/preview.mjs <out.json>
import fs from 'node:fs';
import {Motion} from '../../src/motion.mjs';
import {Preview,PREVIEWS} from '../../src/preview.mjs';
import {mulberry32} from './rng.mjs';

const KEYS=['yaw','pitch','roll','gx','gy','left','right','hair','ahogeWag','ahogeDroop','ahogeSide','earMood','sleep','rubEyes','rubLift','rubHand','dip','dipMix','slump','slumpSide','breath','guard','pain','fringeX','fringeY','towing','shiftX','shiftY','earFoldL','earFoldR','towLean'];
const out=[];
for(const name of Object.keys(PREVIEWS)){
  if(name==='hair')continue;
  const motion=new Motion(mulberry32(3)),preview=new Preview(motion);
  motion.attention.update(1/30,{now:0});motion.step(1/30);
  preview.select(name);
  const d=PREVIEWS[name];
  for(const t of [0,0.5,1,d/2,d]){
    preview.seek(t);
    const c=motion.current,o={name,t};
    for(const k of KEYS)o[k]=typeof c[k]==='boolean'?+c[k]:(c[k]??null);
    o.shift=preview.stageShift();const p=preview.pointer();o.px=p?p.x:null;o.py=p?p.y:null;
    out.push(o);
  }
  // Plain playback for a moment too.
  preview.seek(0);preview.playing=true;for(let i=0;i<30;i++)preview.step(1/60);
  const c=motion.current,o={name,t:'play'};for(const k of KEYS)o[k]=typeof c[k]==='boolean'?+c[k]:(c[k]??null);o.shift=preview.stageShift();out.push(o);
}
fs.writeFileSync(process.argv[2]||'preview-golden.json',JSON.stringify(out));
console.log('records',out.length);
