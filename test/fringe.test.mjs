import test from 'node:test';import assert from 'node:assert/strict';
import {Fringe,FRINGE,deformFringe} from '../src/fringe.mjs';import {Touch,TouchInput} from '../src/touch.mjs';import {Motion} from '../src/motion.mjs';import {Preview} from '../src/preview.mjs';
const tick=(f,seconds,fps=60,reduced=false)=>{let s;for(let i=0;i<Math.round(seconds*fps);i++)s=f.step(1/fps,reduced);return s;};
test('fringe pulling is small, size independent, bounded and returns after release',()=>{
 for(const size of [150,240,460]){const f=new Fringe();f.start({x:0,y:0},size,{x:1100});f.move({x:size*.08,y:-size*.04});let s=tick(f,.6);assert.ok(s.fringeX>.017&&s.fringeX<=FRINGE.pullX);assert.ok(s.fringeY>=-FRINGE.pullY&&s.fringeY<-.007);f.move({x:1e6,y:-1e6});s=tick(f,.2);assert.ok(s.fringeX<=.018&&s.fringeY>=-.008);f.end();s=tick(f,1.2);assert.ok(Math.abs(s.fringeX)<.00001&&Math.abs(s.fringeY)<.00001);}
});
test('hover brushing is softer than pulling and a parked/absent cursor releases it',()=>{
 const f=new Fringe();f.brush({x:0,y:0},240);f.step(.016);f.brush({x:25,y:12},240,{x:1000});let s=tick(f,.08);assert.ok(s.fringeX>0&&s.fringeX<FRINGE.brushX);assert.ok(s.fringeY<FRINGE.brushY);s=tick(f,1.2);assert.ok(s.fringeX<.00001);f.brush(null,240);assert.equal(f.lastBrush,null);
});
test('the damped pose is consistent across frame rates and reduced motion scales down direct manipulation',()=>{
 const samples=[30,60,120].map(fps=>{const f=new Fringe();f.start({x:0,y:0},240);f.move({x:20,y:-10});return tick(f,.4,fps);});for(const s of samples)assert.ok(Math.abs(s.fringeX-samples[0].fringeX)<1e-9);const f=new Fringe();f.start({x:0,y:0},240);f.move({x:100,y:100});const reduced=tick(f,.6,60,true);assert.ok(reduced.fringeX<=FRINGE.pullX*.25&&reduced.fringeY<=FRINGE.pullY*.25);
});
test('fringe input captures the hair rather than moving the window, while face dragging still works',()=>{
 const touch=new Touch(()=>.5),events=[],input=new TouchInput(touch,on=>events.push(on));input.begin('hair_front',{x:100,y:100},240,{source:{x:1000,y:1000}});input.move({x:125,y:95});assert.ok(tick(touch.fringe,.2).fringeX>.01);assert.deepEqual(events,[]);input.end(true);assert.equal(touch.fringe.held,false);assert.deepEqual(events,[]);input.begin(null,{x:0,y:0},240);input.end();assert.deepEqual(events,[true,false]);
});
test('deformation pins roots and keeps the front-hair grid oriented at maximum movement',()=>{
 for(const sx of [-1,1])for(const sy of [-1,1])for(const focus of [.25,.5,.8]){const s={fringeX:sx*.018,fringeY:sy*.008,fringeFocus:focus};assert.deepEqual(deformFringe(1000,600,s),[1000,600]);for(let x=355;x<1500;x+=50)for(let y=650;y<1800;y+=50){const a=deformFringe(x,y,s),b=deformFringe(x+50,y,s),c=deformFringe(x,y+50,s);assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0);}}
});
test('the editor fringe preview is reproducible and relaxes at the end',()=>{
 const m=new Motion(()=>.5),p=new Preview(m);p.select('fringe');p.seek(.9);const x=m.current.fringeX;assert.ok(x>.014&&x<.018);p.seek(.2);p.seek(.9);assert.equal(m.current.fringeX,x);p.seek(3);assert.ok(Math.abs(m.current.fringeX)<.00001);p.release();assert.equal(m.touch.fringe.held,false);
});
test('brushing the fringe near a sleeping character never clears its sleep latch',()=>{
 const m=new Motion(()=>.5),a=m.attention;a.sleepController.sleeping=true;a.sleepController.depth=a.sleepController.closure=1;for(let i=0;i<100;i++){m.touch.fringe.brush({x:120+i,y:110},240,{x:1100});a.update(1/60,{x:120+i,y:110,size:240,near:true,overHead:true});m.step(1/60);assert.equal(m.current.sleeping,true);}
});
