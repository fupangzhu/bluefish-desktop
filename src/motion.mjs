import {Touch} from './touch.mjs';
import {Attention} from './attention.mjs';
import {Eyelids} from './eyelids.mjs';
// Original control implementation; inspired by the damped motion described by GrokBot.
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const YAW_LEFT=8;   // max turn to screen-left (deg); right stays 18
export const PARAMETERS={ParamAngleX:[-YAW_LEFT,18,0],ParamAngleY:[-12,12,0],ParamAngleZ:[-10,10,0],ParamEyeLOpen:[0,1,1],ParamEyeROpen:[0,1,1],ParamEyeBallX:[-1,1,0],ParamEyeBallY:[-1,1,0]};
export class Spring {
  constructor(value=0,frequency=10){this.value=value;this.velocity=0;this.frequency=frequency;}
  step(target,dt){
    // Exact critically damped solution; stable across frame rates and background tabs.
    dt=clamp(dt,0,0.1);const w=this.frequency,x=this.value-target,e=Math.exp(-w*dt),c=this.velocity+w*x;
    this.value=target+(x+c*dt)*e;this.velocity=(this.velocity-w*c*dt)*e;
    return this.value;
  }
}
export function validateCue(value){
  if(!value||!Array.isArray(value.curves)||value.curves.length<1||value.curves.length>40||!Number.isFinite(value.duration)||value.duration<=0||value.duration>30)throw Error('动作需要 0–30 秒时长和 1–40 条曲线');
  const names=new Set();
  const curves=value.curves.map(c=>{
    if(!Object.hasOwn(PARAMETERS,c.parameter)||names.has(c.parameter)||!Array.isArray(c.keys)||c.keys.length<3||c.keys.length>64)throw Error('未知、重复参数或关键帧数量错误');
    names.add(c.parameter);let previous=-1;const keys=c.keys.map(k=>{
      if(!Array.isArray(k)||k.length!==2||!k.every(Number.isFinite)||Math.abs(k[1])>1000000||k[0]<0||k[0]>1||k[0]<=previous)throw Error('关键帧时间必须在 0–1 内递增，偏移不得超出数值范围');previous=k[0];return [...k];
    });
    if(keys[0][0]!==0||keys.at(-1)[0]!==1||keys[0][1]!==0||keys.at(-1)[1]!==0)throw Error('临时动作必须从零偏移开始并回到零');
    return {parameter:c.parameter,keys};
  });return {duration:value.duration,curves};
}
export function cueSample(cue,elapsed){
  if(elapsed<0||elapsed>=cue.duration)return {};
  const phase=elapsed/cue.duration,out={};
  for(const c of cue.curves){for(let i=1;i<c.keys.length;i++){const a=c.keys[i-1],b=c.keys[i];if(phase>b[0])continue;let t=(phase-a[0])/(b[0]-a[0]);t=t*t*(3-2*t);out[c.parameter]=a[1]+(b[1]-a[1])*t;break;}}
  return out;
}
// Adapts one already-resolved PromptSoul segment; no dependency on its Cubism runtime.
export function fromPromptSoulSegment(segment,duration=3){
  if(!segment||!Array.isArray(segment.cues)||segment.cues.length>3||!Number.isSafeInteger(segment.seq)||segment.seq<0)throw Error('不是有效的 PromptSoul segment');
  return segment.cues.map(c=>{
    if(!Number.isFinite(c.at)||!Number.isFinite(c.span)||c.at<0||c.span<=0||c.at+c.span>1)throw Error('cue 时间超出片段');
    return {delay:c.at*duration,cue:validateCue({duration:c.span*duration,curves:c.curves})};
  });
}
export class Motion {
  constructor(random=Math.random){this.random=random;this.touch=new Touch(random);this.attention=new Attention();this.eyelids=new Eyelids(random);this.gaze={x:0,y:0};this.pose={yaw:0,pitch:0,roll:0};this.springs=Object.fromEntries(['yaw','pitch','roll','gx','gy','hair','droop','ears'].map(k=>[k,new Spring(0,k==='hair'?6:k==='droop'?5:k==='ears'?5.5:11)]));this.time=0;this.nextBlink=3+random()*3;this.blinkAt=-100;this.gestureAt=-100;this.gestureName='';this.queue=[];this.follow=true;this.idle=true;this.reduced=false;this.override=null;}
  setGaze(x,y){if(Number.isFinite(x)&&Number.isFinite(y))this.gaze={x:clamp(x,-1,1),y:clamp(y,-1,1)};}
  blink(){this.blinkAt=this.time;this.eyelids.blink(this.time);}
  gesture(name){if(name==='blink')this.blink();else{this.gestureName=name;this.gestureAt=this.time;}}
  playCue(cue,delay=0){const c=validateCue(cue);if(!Number.isFinite(delay)||delay<0||delay>30)throw Error('无效延迟');this.queue=this.queue.filter(q=>q.end>this.time);if(this.queue.length>=24)throw Error('动作队列已满');this.queue.push({...c,start:this.time+delay,end:this.time+delay+c.duration});}
  reset(){this.queue=[];this.touch.reset();this.attention.reset();this.eyelids.reset();this.springs.ears.value=0;this.springs.ears.velocity=0;this.pose={yaw:0,pitch:0,roll:0};this.gestureAt=-100;this.gaze={x:0,y:0};this.blinkAt=-100;this.nextBlink=this.time+3;}
  step(dt){
    this.time+=clamp(dt,0,0.1);const t=this.time,touch=this.touch.step(dt,this.reduced,this.idle);
    if(this.idle&&!this.reduced&&t>=this.nextBlink){this.blink();this.nextBlink=t+3.2+this.random()*4;}
    const attention=this.attention.current,pet=attention.rub||0;
    const lids=this.eyelids.sample(t,attention);
    const ov=this.override,ovGaze=ov&&ov.gx!==undefined,gx=ovGaze?clamp(ov.gx||0,-1,1):this.follow?this.gaze.x*(this.attention.time>0?attention.gazeWeight:1):0,gy=ovGaze?clamp(ov.gy||0,-1,1):this.follow?this.gaze.y*(this.attention.time>0?attention.gazeWeight:1):0;   // an override without gx (e.g. only droop) keeps normal gaze
    const target={yaw:this.pose.yaw+gx*14,pitch:this.pose.pitch-gy*8-touch.pain*3,roll:this.pose.roll+gx*2.5+touch.ahogePullX*15};
    if(ov){target.yaw+=ov.yaw||0;target.roll+=ov.roll||0;}
    if(this.idle&&!this.reduced){target.pitch+=Math.sin(t*1.35)*0.65*(1-pet);target.roll+=Math.sin(t*0.65)*0.45*(1-pet);}
    if(pet){for(const key of ['yaw','pitch','roll'])target[key]=this.pose[key]+(target[key]-this.pose[key])*(1-pet)+(this.reduced?0:attention[key]||0)*pet;}
    for(const key of ['yaw','pitch','roll'])this.springs[key].frequency=pet>.1?3.2:11;
    const gt=t-this.gestureAt,env=gt>=0&&gt<1.8?Math.sin(gt/1.8*Math.PI):0;
    if(this.gestureName==='nod')target.pitch+=Math.sin(gt*10)*6*env;
    if(this.gestureName==='shakehead')target.yaw+=Math.sin(gt*11)*10*env;
    if(this.gestureName==='happy')target.roll+=Math.sin(gt*8)*5*env;
    const wag=this.gestureName==='happy'&&!this.reduced&&env>0?(Math.sin(gt*16)*14+Math.sin(gt*9+1)*3)*env:0;   // ahoge wag with a little bounce
    const droopTarget=Math.max(ov?clamp(ov.droop||0,0,1):0,attention.droop||0)*(1-pet),droopSpring=this.springs.droop;droopSpring.frequency=droopTarget>droopSpring.value?5:9.5;   // wilt ~1s, perk up ~0.5s
    const excited=this.gestureName==='happy'?env:0,earTarget=excited*(1-droopTarget)-droopTarget;
    this.springs.ears.frequency=earTarget<this.springs.ears.value?5.5:8.5;
    const p={ParamAngleX:target.yaw,ParamAngleY:target.pitch,ParamAngleZ:target.roll,ParamEyeLOpen:lids.left,ParamEyeROpen:lids.right,ParamEyeBallX:gx,ParamEyeBallY:gy};
    this.queue=this.queue.filter(q=>q.end>t);
    for(const q of this.queue){for(const [k,v] of Object.entries(cueSample(q,t-q.start)))p[k]+=v;}
    // Turning to screen-left flattens the 2.5D art quickly, so ease into a smaller limit on that side.
    if(p.ParamAngleX<0)p.ParamAngleX=-YAW_LEFT*Math.tanh(-p.ParamAngleX/YAW_LEFT);
    for(const [k,[lo,hi]] of Object.entries(PARAMETERS))p[k]=clamp(p[k],lo,hi);
    if(ov&&Number.isFinite(ov.eyeCap)){p.ParamEyeLOpen=Math.min(p.ParamEyeLOpen,ov.eyeCap);p.ParamEyeROpen=Math.min(p.ParamEyeROpen,ov.eyeCap);}
    const ease=(k,v)=>this.reduced?(this.springs[k].value=v):this.springs[k].step(v,dt);
    if(this.gestureName==='wink'&&gt>=0&&gt<.6)p.ParamEyeLOpen*=Math.abs(Math.cos(gt/.6*Math.PI));
    return this.current={yaw:ease('yaw',p.ParamAngleX),pitch:ease('pitch',p.ParamAngleY),roll:ease('roll',p.ParamAngleZ),gx:ease('gx',p.ParamEyeBallX),gy:ease('gy',p.ParamEyeBallY),left:p.ParamEyeLOpen,right:p.ParamEyeROpen,hair:ease('hair',p.ParamAngleX),ahogeWag:wag,ahogeDroop:ease('droop',droopTarget),earMood:clamp(ease('ears',earTarget),-1,1),rub:pet,relax:attention.relax||0,time:t,secondary:this.idle&&!this.reduced,breath:this.idle&&!this.reduced?Math.sin(t*1.6)*.0018:0,...touch};
  }
}
