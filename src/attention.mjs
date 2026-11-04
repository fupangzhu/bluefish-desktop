export const ATTENTION={stillAfter:7,awayAfter:3,nearGrace:1.2,rubSettle:3};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=n=>{n=clamp(n,0,1);return n*n*(3-2*n);};
// Coordinates are local CSS pixels; movement is measured before head deformation.
export class Attention{
 constructor(){this.reset();}
 reset(){this.time=0;this.last=null;this.lastMove=-100;this.lastNear=0;this.rubAge=0;this.rubMix=0;this.gazeWeight=0;this.droop=0;this.swayX=0;this.swayY=0;this.current={gazeWeight:0,rub:0,relax:0,eyeCap:1,droop:0,yaw:0,roll:0,attentive:false};}
 update(dt,input={}){
  dt=clamp(Number.isFinite(dt)?dt:0,0,.1);this.time+=dt;
  const size=Math.max(1,input.size||240),valid=Number.isFinite(input.x)&&Number.isFinite(input.y),near=valid&&!!input.near;
  const moved=valid&&(!this.last||Math.hypot(input.x-this.last.x,input.y-this.last.y)>=Math.max(.6,size*.003));
  if(valid)this.last={x:input.x,y:input.y};else this.last=null;
  if(moved){this.lastMove=this.time;if(near)this.lastNear=this.time;}
  if(input.poke){this.lastNear=this.lastMove=this.time;}
  const stroking=valid&&input.overHead&&!input.blocked;
  const recent=this.time-this.lastMove<.3;
  if(stroking&&(recent||this.rubAge>.35))this.rubAge=Math.min(4,this.rubAge+dt);
  else this.rubAge=Math.max(0,this.rubAge-dt*3.5);
  const rubbing=stroking&&this.rubAge>.12;
  const blend=(a,b,rate)=>a+(b-a)*(1-Math.exp(-dt*rate));
  this.rubMix=blend(this.rubMix,rubbing?1:0,rubbing?6:7);
  const relax=smooth((this.rubAge-.45)/(ATTENTION.rubSettle-.45));
  const look=(near||this.time-this.lastNear<ATTENTION.awayAfter)&&this.time-this.lastMove<ATTENTION.stillAfter&&this.time-this.lastNear<ATTENTION.stillAfter;
  this.gazeWeight=blend(this.gazeWeight,look?1:0,look?5:2);
  const age=this.time-this.lastNear;
  this.droop=blend(this.droop,rubbing?0:smooth((age-7)/11),rubbing?5:1.8);
  this.swayX=blend(this.swayX,clamp(input.hx||0,-1,1),3.2);this.swayY=blend(this.swayY,clamp(input.hy||0,-1,1),3.2);
  return this.current={gazeWeight:this.gazeWeight,rub:this.rubMix,relax,eyeCap:Math.min(1-relax*this.rubMix,1-.32*this.droop),droop:this.droop,
   yaw:this.swayX*6*(1-relax),roll:this.swayX*2.4*(1-relax),pitch:-this.swayY*2*(1-relax),
   attentive:near&&(this.time-this.lastMove<ATTENTION.nearGrace||rubbing),rubbing};
 }
}
// Excludes the ahoge/ears, while admitting a little space around the scalp.
export function headContact(x,y,size){const hx=(x/size-.5)/.30,hy=(y/size-.46)/.23;return hx*hx+hy*hy<1;}
