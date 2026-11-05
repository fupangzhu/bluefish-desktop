// A one-shot response to recovery from awake drooping; sleeping uses Wake instead.
export const RELUCTANCE={chance:.30,duration:3.6,cooldown:30,minDroop:.85,shift:.025};
const smooth=n=>{n=Math.max(0,Math.min(1,n));return n*n*(3-2*n);};
export class Reluctance{
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(){this.time=0;this.armed=false;this.elapsed=null;this.nextAt=0;this.direction=-1;}
 get active(){return this.elapsed!==null;}
 update(dt,{droop=0,active=false,eligible=true,enabled=true,hx=0,innerSide=-1}={}){
  dt=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));this.time+=dt;
  if(!eligible||!enabled){this.elapsed=null;this.armed=false;return this.sample();}
  if(!this.active&&droop>=RELUCTANCE.minDroop&&!active&&this.time>=this.nextAt)this.armed=true;
  if(!this.active&&this.armed&&active){
   this.armed=false;this.nextAt=this.time+RELUCTANCE.cooldown;
   if(this.random()<RELUCTANCE.chance){this.direction=Math.abs(hx)>.12?-Math.sign(hx):Math.sign(innerSide)||-1;this.elapsed=0;}
  }
  if(this.active){this.elapsed+=dt;if(this.elapsed>=RELUCTANCE.duration)this.elapsed=null;}
  return this.sample();
 }
 sample(){
  const t=this.elapsed??0,active=this.active,mix=active?smooth(t/.4)*(1-smooth((t-2.6)/.8)):0;
  const shift=active?smooth((t-.35)/.65)*(1-smooth((t-2.85)/.75)):0;
  return {active,mix,gx:this.direction*.95,yaw:this.direction*3.5*mix,roll:this.direction*.6*mix,shiftX:shift?this.direction*RELUCTANCE.shift*shift:0,eyeCap:1-.5*mix};
 }
}
