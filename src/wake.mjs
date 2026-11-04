// One weighted preset per actual sleep-to-awake transition, never per hover/frame.
export class Wake{
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(){this.preset=null;this.elapsed=0;this.started=false;}
 get active(){return this.preset!==null;}
 start(){const draw=this.random();this.preset=draw<.5?'gentle':draw<.8?'stretch':'lookaround';this.elapsed=0;this.started=false;}
 step(dt,{eyesOpen=false,reduced=false}={}){
  const zero={yaw:0,pitch:0,roll:0,gx:0,wag:0,ears:0};
  if(!this.active)return zero;
  if(!this.started){if(!eyesOpen)return zero;this.started=true;}
  this.elapsed+=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));
  const duration=reduced?.35:this.preset==='gentle'?2.2:this.preset==='stretch'?2.8:3;
  const u=Math.min(1,this.elapsed/duration),env=Math.sin(Math.PI*u);
  if(u>=1){this.reset();return zero;}if(reduced)return zero;
  if(this.preset==='gentle')return {...zero,pitch:-1.8*env,roll:.8*Math.sin(u*Math.PI*2)*env,wag:3*Math.sin(u*Math.PI*4)*env,ears:.12*env};
  if(this.preset==='stretch')return {...zero,pitch:-4*env,roll:2*Math.sin(u*Math.PI*2)*env,wag:8*Math.sin(u*Math.PI*6)*env,ears:.45*env};
  return {...zero,yaw:5.5*Math.sin(u*Math.PI*2)*env,pitch:-.8*env,roll:.8*Math.sin(u*Math.PI*2)*env,gx:.35*Math.sin(u*Math.PI*2)*env,wag:3.5*Math.sin(u*Math.PI*5)*env,ears:.15*env};
 }
}
