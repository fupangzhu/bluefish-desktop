// One draw per sleeping click. A peek never clears the Sleep latch.
export const WAKE={normal:.6,rub:.25,peek:.15,peekDuration:2.4,retryWindow:15};
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
export class Wake{
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(){this.finish();this.protectUntil=-Infinity;this.requestAt=0;}
 finish(){this.preset=null;this.elapsed=0;this.started=false;}
 get active(){return this.preset!==null;}
 pick(protectedWake=false){const raw=this.random(),draw=Math.max(0,Math.min(1-Number.EPSILON,Number.isFinite(raw)?raw:0))*(protectedWake?WAKE.normal+WAKE.rub:1);this.nextRubHand=draw<WAKE.normal+WAKE.rub*.5?0:1;return draw<WAKE.normal*.5?'gentle':draw<WAKE.normal*.8?'stretch':draw<WAKE.normal?'lookaround':draw<WAKE.normal+WAKE.rub?'rubeyes':'peek';}
 start(preset=this.pick(),hand=this.nextRubHand??0){this.preset=preset;this.rubHand=hand===1?1:0;this.elapsed=0;this.started=false;}
 request(now=0){
  const protectedWake=this.preset==='peek'||now<=this.protectUntil;this.requestAt=now;this.start(this.pick(protectedWake));
  if(this.preset==='peek'){this.protectUntil=now+WAKE.peekDuration+WAKE.retryWindow;return false;}return true;
 }
 step(dt,{eyesOpen=false,reduced=false,clock=null}={}){
  const zero={yaw:0,pitch:0,roll:0,gx:0,wag:0,ears:0};
  if(!this.active)return zero;
  if(!this.started){if(!eyesOpen&&this.preset!=='rubeyes'&&this.preset!=='peek')return zero;this.started=true;}
  this.elapsed+=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));
  const duration=this.preset==='peek'?(reduced?1.4:WAKE.peekDuration):reduced?.35:this.preset==='rubeyes'?5.2:this.preset==='gentle'?2.2:this.preset==='stretch'?2.8:3;
  const u=Math.min(1,this.elapsed/duration),env=Math.sin(Math.PI*u);
  if(u>=1){if(this.preset==='peek')this.protectUntil=(Number.isFinite(clock)?clock:this.requestAt+duration)+WAKE.retryWindow;this.finish();return zero;}
  if(this.preset==='peek'){
   const t=this.elapsed,scale=reduced?1.4/WAKE.peekDuration:1,phase=t/scale;
   const ear=smooth(phase/.4)*(1-smooth((phase-1.35)/.9)),eye=smooth((phase-.25)/.45)*(1-smooth((phase-1.3)/.75));
   return {...zero,peekEye:.22*eye,peekEar:ear*(reduced?.22:1)};
  }
  if(reduced)return zero;
  if(this.preset==='rubeyes'){
   const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);},t=this.elapsed;
   const hands=smooth((t-1.25)/.8)*(1-smooth((t-3.15)/.7));
   return {...zero,pitch:-1.4*env,eyeCap:smooth((t-3.2)/1.6),rubEyes:hands,rubHand:this.rubHand,rubPhase:t*18,rubLift:smooth((t-1.3)/.8)*(1-smooth((t-4.7)/.5))*.075};
  }
  if(this.preset==='gentle')return {...zero,pitch:-1.8*env,roll:.8*Math.sin(u*Math.PI*2)*env,wag:3*Math.sin(u*Math.PI*4)*env,ears:.12*env};
  if(this.preset==='stretch')return {...zero,pitch:-4*env,roll:2*Math.sin(u*Math.PI*2)*env,wag:8*Math.sin(u*Math.PI*6)*env,ears:.45*env};
  return {...zero,yaw:5.5*Math.sin(u*Math.PI*2)*env,pitch:-.8*env,roll:.8*Math.sin(u*Math.PI*2)*env,gx:.35*Math.sin(u*Math.PI*2)*env,wag:3.5*Math.sin(u*Math.PI*5)*env,ears:.15*env};
 }
}
