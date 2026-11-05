// Gentle local bends shared by mouse brushing and direct pulling.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=n=>{n=clamp(n,0,1);return n*n*(3-2*n);};
export const FRINGE={pullX:.018,pullY:.008,brushX:.008,brushY:.003};
export class Fringe{
 constructor(){this.reset();}
 reset(){this.time=0;this.held=false;this.anchor=null;this.lastBrush=null;this.brushUntil=0;this.focus=.5;this.target={x:0,y:0};this.value={x:0,y:0};this.velocity={x:0,y:0};}
 start(point,size,source=null){this.held=true;this.anchor={...point,size};this.lastBrush=null;this.focus=clamp((source?.x??1024)/2048,0,1);this.target={x:0,y:0};}
 move(point){if(!this.held||!this.anchor)return;const a=this.anchor;if(![point.x,point.y,a.size].every(Number.isFinite)||a.size<=0)return;this.target={x:clamp((point.x-a.x)/a.size*.3,-FRINGE.pullX,FRINGE.pullX),y:clamp((point.y-a.y)/a.size*.25,-FRINGE.pullY,FRINGE.pullY)};}
 end(){this.held=false;this.anchor=null;this.lastBrush=null;this.target={x:0,y:0};this.brushUntil=0;}
 brush(point,size,source=null){
  if(this.held)return;
  if(!point||![point.x,point.y,size].every(Number.isFinite)||size<=0){this.lastBrush=null;this.target={x:0,y:0};return;}
  const previous=this.lastBrush;this.lastBrush={...point,time:this.time};if(!previous||this.time-previous.time>.2)return;
  const dx=(point.x-previous.x)/size,dy=(point.y-previous.y)/size;if(Math.hypot(dx,dy)<.001)return;
  this.focus=clamp((source?.x??1024)/2048,0,1);this.target={x:clamp(this.target.x*.4+dx*.25,-FRINGE.brushX,FRINGE.brushX),y:clamp(this.target.y*.4+dy*.18,-FRINGE.brushY,FRINGE.brushY)};this.brushUntil=this.time+.1;
 }
 step(dt,reduced=false){
  dt=clamp(Number.isFinite(dt)?dt:0,0,.1);this.time+=dt;if(!this.held&&this.time>this.brushUntil)this.target={x:0,y:0};
  const w=this.held?14:9,scale=reduced?.25:1,e=Math.exp(-w*dt);
  for(const key of ['x','y']){const target=this.target[key]*scale,x=this.value[key]-target,c=this.velocity[key]+w*x;this.value[key]=target+(x+c*dt)*e;this.velocity[key]=(this.velocity[key]-w*c*dt)*e;const limit=(key==='x'?FRINGE.pullX:FRINGE.pullY)*scale;if(Math.abs(this.value[key])>limit){this.value[key]=clamp(this.value[key],-limit,limit);this.velocity[key]=0;}if(Math.abs(this.value[key])<1e-6&&Math.abs(this.velocity[key])<1e-5)this.value[key]=this.velocity[key]=0;}
  return {fringeX:this.value.x,fringeY:this.value.y,fringeFocus:this.focus};
 }
}
export function deformFringe(px,py,s){const tip=smooth((py-650)/850),spread=.25+.75*Math.exp(-(((px/2048-(s.fringeFocus??.5))/.20)**2)),weight=tip*spread;return [px+(s.fringeX||0)*2048*weight,py+(s.fringeY||0)*2048*weight];}
