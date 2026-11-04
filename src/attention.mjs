export const ATTENTION={stillAfter:7,awayAfter:3,nearGrace:1.2,rubSettle:3,wakeDelayMin:2,wakeDelayMax:5};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=n=>{n=clamp(n,0,1);return n*n*(3-2*n);};
// Coordinates are local CSS pixels; movement is measured before head deformation.
export class Attention{
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(){this.time=0;this.last=null;this.lastMove=-100;this.lastNear=0;this.rubAge=0;this.rubMix=0;this.restUntil=0;this.wasStroking=false;this.gazeWeight=0;this.droop=0;this.swayX=0;this.swayY=0;this.current={gazeWeight:0,rub:0,relax:0,eyeCap:1,droop:0,yaw:0,roll:0,attentive:false,rubbing:false,resting:false,interacting:false};}
 update(dt,input={}){
  dt=clamp(Number.isFinite(dt)?dt:0,0,.1);this.time+=dt;
  const size=Math.max(1,input.size||240),valid=Number.isFinite(input.x)&&Number.isFinite(input.y),near=valid&&!!input.near;
  const moved=valid&&(!this.last||Math.hypot(input.x-this.last.x,input.y-this.last.y)>=Math.max(.6,size*.003));
  if(valid)this.last={x:input.x,y:input.y};else this.last=null;
  if(moved){this.lastMove=this.time;if(near)this.lastNear=this.time;}
  if(input.poke){this.lastNear=this.lastMove=this.time;}
  const stroking=valid&&input.overHead&&!input.blocked;
  // Sample one wake delay on leaving a relaxed rub, not on every pointer tick.
  if(input.blocked||input.poke)this.restUntil=0;
  else if(stroking)this.restUntil=0;
  else if(this.wasStroking&&this.current.relax>.8&&this.rubMix>.8){
   this.restUntil=this.time+ATTENTION.wakeDelayMin+(ATTENTION.wakeDelayMax-ATTENTION.wakeDelayMin)*clamp(this.random(),0,1);
  }
  this.wasStroking=stroking;
  const resting=!stroking&&this.time<this.restUntil;
  const recent=this.time-this.lastMove<.3;
  if(stroking&&(recent||this.rubAge>.35))this.rubAge=Math.min(4,this.rubAge+dt);
  else if(!resting)this.rubAge=Math.max(0,this.rubAge-dt*3.5);
  const rubbing=stroking&&this.rubAge>.12,comfortable=rubbing||resting;
  const blend=(a,b,rate)=>a+(b-a)*(1-Math.exp(-dt*rate));
  this.rubMix=blend(this.rubMix,comfortable?1:0,comfortable?6:7);
  const relax=smooth((this.rubAge-.45)/(ATTENTION.rubSettle-.45));
  const look=(near||this.time-this.lastNear<ATTENTION.awayAfter)&&this.time-this.lastMove<ATTENTION.stillAfter&&this.time-this.lastNear<ATTENTION.stillAfter;
  this.gazeWeight=blend(this.gazeWeight,look?1:0,look?5:2);
  const age=this.time-this.lastNear;
  this.droop=blend(this.droop,comfortable?0:smooth((age-7)/11),comfortable?5:1.8);
  this.swayX=blend(this.swayX,clamp(input.hx||0,-1,1),3.2);this.swayY=blend(this.swayY,clamp(input.hy||0,-1,1),3.2);
  return this.current={gazeWeight:this.gazeWeight,rub:this.rubMix,relax,eyeCap:Math.min(1-relax*this.rubMix,1-.32*this.droop),droop:this.droop,
   yaw:this.swayX*6*(1-relax),roll:this.swayX*2.4*(1-relax),pitch:-this.swayY*2*(1-relax),
   attentive:near&&(this.time-this.lastMove<ATTENTION.nearGrace||rubbing),rubbing,resting,interacting:!!input.blocked||!!input.poke};
 }
}
// Excludes the ahoge/ears, while admitting a little space around the scalp.
export function headContact(x,y,size){const hx=(x/size-.5)/.30,hy=(y/size-.46)/.23;return hx*hx+hy*hy<1;}
