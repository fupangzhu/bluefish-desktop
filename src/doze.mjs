// Long sleep timers use wall time; easing uses bounded frame time.
export const DOZE={firstEar:[20,40],earEvery:[150,300],firstSide:[35,65],sideEvery:[80,240],breathAmplitude:.0024};
export class Doze{
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(){this.active=false;this.time=0;this.lastClock=null;this.ear=null;this.side=0;this.sideTarget=0;this.lean=1;}
 interval(range){return range[0]+this.random()*(range[1]-range[0]);}
 twitch(side,dt=1/60){this.ear={side:side==='r'?'r':'l',at:this.time-Math.min(.025,dt/2),count:1,period:.12,amplitude:.7};return this.ear;}
 step(dt,{sleeping=false,reduced=false,now=null}={}){
  const zero={breath:0,wag:0,ear:null};
  if(!sleeping){this.reset();return zero;}
  dt=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));const clock=Number.isFinite(now)?now:null,advance=clock!==null&&this.lastClock!==null?Math.max(0,clock-this.lastClock):dt;this.lastClock=clock;
  if(reduced){this.ear=null;return zero;}
  if(!this.active){this.active=true;this.nextEar=this.interval(DOZE.firstEar);this.nextSide=this.interval(DOZE.firstSide);this.breathPeriod=20+this.random()*8;this.swayPeriod=35+this.random()*25;}
  this.time+=advance;
  if(this.time>=this.nextEar){this.twitch(this.random()<.5?'l':'r',dt);this.nextEar=this.time+this.interval(DOZE.earEvery);}
  if(this.time>=this.nextSide){this.sideTarget=this.sideTarget?-this.sideTarget:-this.lean;this.nextSide=this.time+this.interval(DOZE.sideEvery);}
  this.side+=(this.sideTarget-this.side)*(1-Math.exp(-dt*.3));
  this.lean+=((this.sideTarget||1)-this.lean)*(1-Math.exp(-dt*.65));
  if(this.ear&&this.time-this.ear.at>.2)this.ear=null;
  return {side:this.lean,breath:Math.sin(this.time/this.breathPeriod*Math.PI*2)*DOZE.breathAmplitude,wag:this.side*3.8+Math.sin(this.time/this.swayPeriod*Math.PI*2)*.65,
   ear:this.ear?{...this.ear,elapsed:this.time-this.ear.at}:null};
 }
}
