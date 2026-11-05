// Sparse sleep-only motion. Timers are sampled once, never as per-frame probabilities.
export class Doze{
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(){this.active=false;this.time=0;this.ear=null;this.side=0;this.sideTarget=0;}
 step(dt,{sleeping=false,reduced=false}={}){
  const zero={breath:0,wag:0,ear:null};
  if(!sleeping){this.reset();return zero;}if(reduced)return zero;
  dt=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));
  if(!this.active){this.active=true;this.nextEar=150+this.random()*210;this.nextSide=80+this.random()*160;this.breathPeriod=20+this.random()*8;this.swayPeriod=35+this.random()*25;}
  this.time+=dt;
  if(this.time>=this.nextEar){this.ear={side:this.random()<.5?'l':'r',at:this.time,count:1,period:.095,amplitude:.55};this.nextEar=this.time+150+this.random()*210;}
  if(this.time>=this.nextSide){this.sideTarget=this.sideTarget?-this.sideTarget:(this.random()<.5?-1:1);this.nextSide=this.time+80+this.random()*160;}
  this.side+=(this.sideTarget-this.side)*(1-Math.exp(-dt*.3));
  if(this.ear&&this.time-this.ear.at>.16)this.ear=null;
  return {breath:Math.sin(this.time/this.breathPeriod*Math.PI*2)*.00045,wag:this.side*3.4+Math.sin(this.time/this.swayPeriod*Math.PI*2)*.3,
   ear:this.ear?{...this.ear,elapsed:this.time-this.ear.at}:null};
 }
}
