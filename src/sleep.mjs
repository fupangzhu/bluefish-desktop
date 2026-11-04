export const SLEEP={earliest:120,latest:600,chanceAtStart:.1};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Pick one idle deadline per cycle: 10% sleep at 2min, the rest by 10min.
// idleFor is wall time supplied by Attention; pose easing uses bounded frame time.
export class Sleep{
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(){this.wakeId=0;this.time=0;this.deadline=null;this.sleeping=false;this.closure=0;this.depth=0;this.openAt=null;this.current={sleeping:false,closure:0,depth:0,wakeId:0,woke:false};}
 update(dt,{idleFor=0,active=false,wake=false,eligible=true,reduced=false}={}){
  dt=clamp(Number.isFinite(dt)?dt:0,0,.1);this.time+=dt;
  const woke=!!wake&&this.sleeping;
  if(wake){this.deadline=null;if(woke){this.sleeping=false;this.openAt=null;this.wakeId++;}}
  else if(active&&!this.sleeping)this.deadline=null;
  else if(!this.sleeping&&eligible){
   if(idleFor>=SLEEP.earliest&&this.deadline===null){
    const draw=clamp(this.random(),0,1);
    this.deadline=SLEEP.earliest+(SLEEP.latest-SLEEP.earliest)*Math.max(0,(draw-SLEEP.chanceAtStart)/(1-SLEEP.chanceAtStart));
   }
   if(idleFor>=SLEEP.latest||(this.deadline!==null&&idleFor>=this.deadline)){this.sleeping=true;this.openAt=null;}
  }
  const ease=(a,b,rate)=>a+(b-a)*(1-Math.exp(-dt*rate));
  this.closure=reduced?Number(this.sleeping):ease(this.closure,Number(this.sleeping),this.sleeping?2.5:4.5);
  if(this.closure<.001)this.closure=0;else if(this.closure>.999)this.closure=1;
  if(this.sleeping)this.depth=reduced?1:ease(this.depth,1,1.8);
  else if(this.closure===0){
   this.openAt??=this.time;
   if(this.time-this.openAt>=.1)this.depth=reduced?0:ease(this.depth,0,2.4);
  }else this.openAt=null;
  if(this.depth<.001)this.depth=0;else if(this.depth>.999)this.depth=1;
  return this.current={sleeping:this.sleeping,closure:this.closure,depth:this.depth,wakeId:this.wakeId,woke};
 }
}
