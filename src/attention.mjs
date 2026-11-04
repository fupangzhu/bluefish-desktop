import {Sleep} from './sleep.mjs';
export const ATTENTION={stillAfter:7,awayAfter:3,nearGrace:1.2,rubSettle:3,wakeDelayMin:2,wakeDelayMax:5,rubSessionGap:.65};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=n=>{n=clamp(n,0,1);return n*n*(3-2*n);};
// Coordinates are local CSS pixels; movement is measured before head deformation.
export class Attention{
 constructor(random=Math.random){this.random=random;this.sleepController=new Sleep(()=>this.random());this.reset();}
 reset(){
  this.sleepController.reset();this.idleTime=0;this.lastInteraction=0;this.lastClock=null;
  this.time=0;this.last=null;this.lastMove=-100;this.lastNear=0;this.rubAge=0;this.rubMix=0;
  this.restUntil=0;this.wasStroking=false;this.reaction=null;this.reactionTime=0;this.lastRubAt=-Infinity;this.releaseClosure=0;
  this.gazeWeight=0;this.droop=0;this.swayX=0;this.swayY=0;
  this.current={gazeWeight:0,rub:0,relax:0,eyeCap:1,droop:0,yaw:0,roll:0,pitch:0,ahogeWag:0,reaction:null,sleep:0,sleepClosure:0,sleeping:false,wakeId:0,woke:false,inactiveFor:0,attentive:false,rubbing:false,resting:false,interacting:false};
 }
 pickReaction(){const draw=this.random();return draw<.2?'sleepy':draw<.7?'playful':'subtle';}
 update(dt,input={}){
  dt=clamp(Number.isFinite(dt)?dt:0,0,.1);this.time+=dt;
  const clock=Number.isFinite(input.now)?input.now:null;
  this.idleTime+=clock!==null&&this.lastClock!==null?Math.max(0,clock-this.lastClock):dt;this.lastClock=clock;
  const size=Math.max(1,input.size||240),valid=Number.isFinite(input.x)&&Number.isFinite(input.y),near=valid&&!!input.near;
  const moved=valid&&(!this.last||Math.hypot(input.x-this.last.x,input.y-this.last.y)>=Math.max(.6,size*.003));
  if(valid)this.last={x:input.x,y:input.y};else this.last=null;
  if(moved){this.lastMove=this.time;if(near)this.lastNear=this.time;}
  if(input.poke){this.lastNear=this.lastMove=this.time;}
  const stroking=valid&&input.overHead&&!input.blocked&&!this.sleepController.sleeping&&this.sleepController.depth<.05;
  // Only the sleepy reaction retains closed eyes after departure.
  if(input.blocked||input.poke)this.restUntil=0;
  else if(stroking)this.restUntil=0;
  else if(this.wasStroking&&this.reaction==='sleepy'&&this.current.relax>.8&&this.rubMix>.8){
   this.restUntil=this.time+ATTENTION.wakeDelayMin+(ATTENTION.wakeDelayMax-ATTENTION.wakeDelayMin)*clamp(this.random(),0,1);
  }
  this.wasStroking=stroking;
  const resting=!stroking&&this.time<this.restUntil;
  const recent=this.time-this.lastMove<.3;
  if(stroking&&(recent||(this.rubAge>.35&&this.time-this.lastMove<ATTENTION.stillAfter)))this.rubAge=Math.min(4,this.rubAge+dt);
  else if(!resting)this.rubAge=Math.max(0,this.rubAge-dt*3.5);
  const rubbing=stroking&&this.rubAge>.12,comfortable=rubbing||resting;
  // One draw per session. Brief crossings of the scalp edge keep the same reaction.
  if(rubbing){
   if(!this.reaction||this.time-this.lastRubAt>ATTENTION.rubSessionGap){
    const previous=this.reaction;this.reaction=this.pickReaction();this.reactionTime=0;
    this.releaseClosure=this.reaction==='sleepy'?0:1-this.current.eyeCap;
    if(previous!=='sleepy'||this.reaction!=='sleepy'||this.current.relax<.8)this.rubAge=Math.min(this.rubAge,.15);
   }
   this.lastRubAt=this.time;this.reactionTime+=dt;
  }
  const blend=(a,b,rate)=>a+(b-a)*(1-Math.exp(-dt*rate));
  this.rubMix=blend(this.rubMix,comfortable?1:0,comfortable?6:7);
  this.releaseClosure=blend(this.releaseClosure,0,5);if(this.releaseClosure<.001)this.releaseClosure=0;
  const relax=this.reaction==='sleepy'?smooth((this.rubAge-.45)/(ATTENTION.rubSettle-.45)):this.releaseClosure;
  const look=(near||this.time-this.lastNear<ATTENTION.awayAfter)&&this.time-this.lastMove<ATTENTION.stillAfter&&this.time-this.lastNear<ATTENTION.stillAfter;
  this.gazeWeight=blend(this.gazeWeight,look?1:0,look?5:2);
  const age=this.time-this.lastNear;
  this.droop=blend(this.droop,comfortable?0:smooth((age-7)/11),comfortable?5:1.8);
  this.swayX=blend(this.swayX,clamp(input.hx||0,-1,1),3.2);this.swayY=blend(this.swayY,clamp(input.hy||0,-1,1),3.2);
  let yaw=this.swayX*6*(1-relax),roll=this.swayX*2.4*(1-relax),pitch=-this.swayY*2*(1-relax),ahogeWag=0;
  const phase=this.reactionTime*2.7,activity=(.25+.75*(1-smooth((this.time-this.lastMove-.15)/1)))*smooth(this.reactionTime/.65);
  if(this.reaction==='playful'){
   yaw=(Math.sin(phase)*4.8+this.swayX*2)*activity;
   roll=(Math.sin(phase*1.05+.6)*3.3+this.swayX)*activity;
   pitch=(Math.sin(phase*.8)*2.1-this.swayY*.7)*activity;
   ahogeWag=(Math.sin(phase*2)*9+Math.sin(phase*3.2+.4)*2)*activity*this.rubMix;
  }else if(this.reaction==='subtle'){
   yaw=(this.swayX*1.4+Math.sin(phase*.65)*.5)*activity;
   roll=(this.swayX*.4+Math.sin(phase*.65+.4)*.5)*activity;
   pitch=(-this.swayY*.4+Math.sin(phase*.5)*.3)*activity;
  }
  const active=!!input.wake||!!input.poke||!!input.blocked||(moved&&near);
  if(active)this.lastInteraction=this.idleTime;
  const inactiveFor=this.idleTime-this.lastInteraction;
  const sleep=this.sleepController.update(dt,{idleFor:inactiveFor,active,wake:!!input.wake,eligible:(this.droop>.9&&!rubbing&&!resting)||inactiveFor>=120,reduced:!!input.reduced});
  return this.current={sleep:sleep.depth,sleepClosure:sleep.closure,sleeping:sleep.sleeping,wakeId:sleep.wakeId,woke:sleep.woke,inactiveFor,gazeWeight:this.gazeWeight,rub:this.rubMix,relax,eyeCap:Math.min(1-relax*this.rubMix,!sleep.sleeping&&sleep.depth>0?1:1-.32*this.droop,1-sleep.closure),droop:this.droop,
   yaw,roll,pitch,ahogeWag,reaction:this.reaction,
   attentive:!sleep.sleeping&&near&&(this.time-this.lastMove<ATTENTION.nearGrace||rubbing),rubbing,resting,interacting:!!input.blocked||!!input.poke};
 }
}
// Excludes the ahoge/ears, while admitting a little space around the scalp.
export function headContact(x,y,size){const hx=(x/size-.5)/.30,hy=(y/size-.46)/.23;return hx*hx+hy*hy<1;}
