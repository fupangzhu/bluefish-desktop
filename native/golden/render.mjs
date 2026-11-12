// Golden recorder for the renderer geometry: projected mesh vertices of every drawn layer and the
// parts picked under a grid of points, frame by frame, while Motion animates her and the ahoge is
// pinched (from a real pick), pulled and released. WebGL is stubbed: only the CPU-side geometry runs.
// Run: node native/golden/render.mjs <out.json>
import fs from 'node:fs';
import {Motion} from '../../src/motion.mjs';
import {TouchInput} from '../../src/touch.mjs';
import {Renderer} from '../../src/renderer.mjs';
import {ahogeBounds} from '../../src/ahoge.mjs';
import {mulberry32} from './rng.mjs';

const rig=JSON.parse(fs.readFileSync(new URL('../../assets/rig.json',import.meta.url)));
const noop=new Proxy(function(){},{get:(t,k)=>k==='getShaderParameter'||k==='getProgramParameter'?()=>true:k==='getExtension'?()=>null:noop,apply:()=>({})});
const S=240,PAD=.35,SIZE=Math.round(S*(1+2*PAD)*1.5),rect={left:40,top:-30,width:S*(1+2*PAD),height:S*(1+2*PAD)};
const canvas={width:SIZE,height:SIZE,clientWidth:rect.width,clientHeight:rect.height,getContext:()=>noop,getBoundingClientRect:()=>rect};
globalThis.devicePixelRatio=1.5;
const renderer=new Renderer(canvas,rig);renderer.padding=PAD;
// Layers as Renderer.init builds them, minus the pixels (alpha is all opaque here; pickHit's alpha
// test is checked separately in Rust against the real textures).
const opaque=(w,h)=>new Uint8Array(w*h).fill(255);
for(const meta of rig.layers){
  if(meta.empty)continue;
  if(meta.name==='ahoge'){renderer.addLayer=renderer.addLayer;add({...meta,box:ahogeBounds(),procedural:true},64,512);continue;}
  const [x0,y0,x1,y1]=meta.box;
  if(meta.name.endsWith('_open')&&meta.eyeSide)add({...meta,box:[x0-64,y0-64,x1+64,y1+64]},x1-x0+128,y1-y0+128);
  else add(meta,x1-x0,y1-y0);
}
for(const eye of rig.eyes){const meta=renderer.byName.get(`eye_${eye.side}_closed`);add({...meta,name:`eye_${eye.side}_pain`},meta.box[2]-meta.box[0],meta.box[3]-meta.box[1]);}
function add(meta,w,h){
  const fake={getContext:()=>({getImageData:()=>({data:new Uint8Array(w*h*4).fill(255)})}),width:w,height:h};
  renderer.addLayer(meta,fake);const l=renderer.byName.get(meta.name);l.alpha=opaque(w,h);
}

const motion=new Motion(mulberry32(5));const touch=new TouchInput(motion.touch,()=>{});
const frames=[];
const toCanvas=(x,y)=>({x:x-rect.left,y:y-rect.top});
function pose(c){
  const keys=['yaw','pitch','roll','time','hair','ahogeWag','ahogeDroop','ahogeSide','breath','shiftX','shiftY','fringeX','fringeY','fringeFocus','sleep','earMood','earFoldL','earFoldR','earPressL','earPressR','sideEye','left','right','pain','gx','gy','earMoodL','earSleepL'];
  const o={};for(const k of keys)if(c[k]!==undefined)o[k]=c[k];o.secondary=!!c.secondary;
  for(const s of ['L','R']){const e=c['earTwitch'+s];if(e)o['earTwitch'+s]={elapsed:e.elapsed,count:e.count,period:e.period,amplitude:e.amplitude};}
  const g=c.ahogeGrab;if(g)o.ahogeGrab={source:g.source,binding:g.binding,baseOutline:g.baseOutline,relative:!!g.relative,client:{x:g.client.x,y:g.client.y},held:g.held,strength:g.strength};
  return o;
}
function record(c){
  renderer.render(c);
  const layers={};
  for(const l of renderer.drawn){const d=[];for(let i=0;i<l.data.length;i+=4*7)d.push(l.data[i],l.data[i+1]);layers[l.name]={n:l.data.length/4,d,bounds:[...l.bounds]};}
  const picks=[];
  for(let y=0;y<rect.height;y+=9)for(let x=0;x<rect.width;x+=9){const h=renderer.pickHit(x,y);picks.push(h?[h.part,h.source.x,h.source.y,h.binding?h.binding.t:null]:null);}
  frames.push({pose:pose(c),layers,picks,ahoge:renderer.ahogePose?{outline:renderer.ahogePose.outline,stretch:renderer.ahogePose.stretch}:null});
}
const DT=1/30;
const step=(n,every=6,fn)=>{for(let i=0;i<n;i++){fn?.(i);motion.attention.update(DT,{now:i*DT,size:S});const c=motion.step(DT);if(i%every===0)record(c);}};
motion.setGaze(.6,-.3);step(60);
motion.gesture('happy');step(60,4);
motion.touch.twitch('l');step(20,2);
// Pinch the ahoge where the renderer says it is, pull it around, let go (spring back).
renderer.render(motion.step(DT));
let grip=null,at=null;
for(let y=0;y<rect.height&&!grip;y+=2)for(let x=rect.width*.5;x<rect.width&&!grip;x+=2){const h=renderer.pickHit(x,y);if(h?.part==='ahoge'&&h.binding.t>40){grip=h;at={x:x+rect.left,y:y+rect.top};}}
if(!grip)throw Error('no ahoge under the grid');
touch.begin('ahoge',at,S,grip,{tow:false});
step(80,3,i=>touch.move({x:at.x+i*1.2,y:at.y-Math.sin(i/12)*40}));
touch.end();step(40,2);
// A long straightening pull (taut phase).
touch.begin('ahoge',at,S,grip,{tow:false});step(60,3,i=>touch.move({x:at.x+i*4,y:at.y-i*2}));touch.end();step(40,2);
// Fringe pull, sleep-ish ears, wall press, side-eye.
motion.touch.fringe.start({x:200,y:100},S,{x:1100,y:900});motion.touch.fringe.move({x:210,y:104});step(20,2);motion.touch.fringe.end();
const sleepy=c=>({...c,sleep:.8,earMood:-.6,earPressR:.7,sideEye:.5,left:.3,right:.6,pain:.4,gx:.5,gy:-.4,earMoodL:-.2,earSleepL:.4});
for(let i=0;i<5;i++)record(sleepy(motion.step(DT)));
fs.writeFileSync(process.argv[2]||'render-golden.json',JSON.stringify({size:SIZE,rect,s:S,pad:PAD,frames}));
console.log('frames',frames.length);
