// Pure state machine for the "peeking over the taskbar" behaviour: shuffling sideways, returning, sulking.
// No DOM, time is injected through update(dt). All distances are fractions of the avatar size `s`.
export const CONFIG={
  gazeThreshold:0.4,     // |gx| must exceed this to want to step
  gazeHold:0.7,          // seconds of sustained same-direction gaze before a step
  attentiveWindow:1.5,   // seconds after the last attention that still count as "she is being watched"
  stepSize:0.06,         // head/hand travel per step (x s)
  maxOffset:0.12,        // max |offset| (x s)
  cooldown:1.2,          // seconds between steps (end of one to start of the next)
  returnCooldown:0.7,    // cooldown used while shuffling back home
  stepDuration:0.58,     // one full step, lead hand + trail hand + settle
  headMoveAt:0.12,       // when inside a step the head starts following
  liftHeight:0.025,       // peak hand lift (x s)
  handRotation:0.08,      // rad, outward tilt of the lead hand at peak lift
  squashAmount:0.10,     // landing squash
  ignoreAfter:45,        // seconds without attention before going home and sulking
  sulkExitNear:0.6,      // seconds of "near" that cheer her up
  sulkYaw:12,            // degrees away from the cursor
  sulkRoll:2.5,
  sulkGy:0.1,
  sulkGx:0.85,
  eyeCap:0.55,
  flipThreshold:0.25,    // cursor must be this far on the side she faces before she turns away again
  headSpring:9,
  headRoll:2.8,          // degrees of head tilt during a step
  headBob:0.012,         // px bob as a fraction of s
  maxSubStep:0.05,
  idleSqueezeHz:[0.37,0.29],   // per-hand slow squeeze frequency (Hz)
  tapEvery:[4,9],        // seconds between idle taps (random per hand)
  tapDuration:0.25,      // lift time of an idle tap
  tapLand:0.12,          // landing squash after a tap
  returnDroopFrom:0.3,   // ahoge droop while shuffling home after being ignored: ramps up to returnDroopTo
  returnDroopTo:0.6,
  returnDroopRamp:4
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const easeOut=t=>{t=clamp(t,0,1);return 1-(1-t)**3;};
const easeIn=t=>{t=clamp(t,0,1);return t*t*t;};
const seg=(u,a,b)=>clamp((u-a)/(b-a),0,1);
// Critically damped spring, exact for any dt.
class Spring1{constructor(v=0,w=9){this.value=v;this.velocity=0;this.w=w;}step(target,dt){const x=this.value-target,e=Math.exp(-this.w*dt),c=this.velocity+this.w*x;this.value=target+(x+c*dt)*e;this.velocity=(this.velocity-this.w*c*dt)*e;return this.value;}}

// Timeline of one hand inside a step (u = seconds since the step began).
// lead hand: lifts, travels, lands. trailing hand: same, a little later.
const LEAD={liftUp:[0,0.14],hold:0.26,liftDown:[0.26,0.34],move:[0.06,0.26],land:0.34,settle:0.14};
const TRAIL={liftUp:[0.22,0.32],hold:0.40,liftDown:[0.40,0.48],move:[0.28,0.42],land:0.48,settle:0.10};
function handPhase(u,t,rotAmount,dir,c){
  const rise=easeOut(seg(u,t.liftUp[0],t.liftUp[1])),fall=easeIn(seg(u,t.liftDown[0],t.liftDown[1]));
  const lift=rise*(1-fall);
  const move=smooth(seg(u,t.move[0],t.move[1]));
  const sq=u>=t.land?Math.sin(Math.PI*seg(u,t.land,t.land+t.settle))*c.squashAmount*(1-seg(u,t.land,t.land+t.settle)*0.3):0;
  return {lift:lift*c.liftHeight,move,rot:dir*rotAmount*lift,squash:sq};
}

export class Peek{
  constructor({size=240,config={},random=Math.random}={}){
    this.random=random;
    this.size=size;this.cfg={...CONFIG,...config};
    this.time=0;this.lastAttention=0;this.lastWatch=-100;this.mode='rest';
    this.committed=0;         // resting hand shift / head target (x s); changes when a step lands
    this.headTarget=0;
    this.head=new Spring1(0,this.cfg.headSpring);
    this.step=null;           // {dir,from,to,t}
    this.lastStepEnd=-100;
    this.gazeDir=0;this.gazeTimer=0;
    this.nearTimer=0;this.away=1;this.reducedSnap=false;
    this.returnT=0;this.reducedNow=false;this.held=false;
    // idle micro-motion of each hand (independent): squeeze phase + occasional tap. tapT<0 = no tap running.
    this.idle=[0,1].map(i=>({phase:i*1.9,tapT:-1,nextTap:this.cfg.tapEvery[0]+this.random()*(this.cfg.tapEvery[1]-this.cfg.tapEvery[0])}));
  }
  setSize(size){if(Number.isFinite(size)&&size>0)this.size=size;}
  get offset(){return this.committed;}
  forceSulk(){this.step=null;this.mode='sulk';this.nearTimer=0;this.lastAttention=this.time-this.cfg.ignoreAfter-1;}
  forceStep(dir){dir=Math.sign(dir)||1;this.beginStep(dir,false);}
  beginStep(dir,reduced){
    const c=this.cfg,to=clamp(this.committed+dir*c.stepSize,-c.maxOffset,c.maxOffset);
    if(Math.abs(to-this.committed)<1e-6||this.step)return false;
    if(reduced){this.committed=to;this.headTarget=to;this.lastStepEnd=this.time;this.reducedSnap=true;return true;}
    this.step={dir,from:this.committed,to,t:0,headSet:false};this.gazeTimer=0;return true;
  }
  update(dt,input={}){
    let n=Math.max(1,Math.ceil(dt/this.cfg.maxSubStep)),sub=dt/n,gesture;
    for(let i=0;i<n;i++){
      const g=this.tick(sub,i===0?input:{...input,poke:false});
      if(g)gesture=g;
    }
    const out=this.snapshot();if(gesture)out.gesture=gesture;return out;
  }
  enterSulk(gx){this.mode='sulk';this.nearTimer=0;if(Math.abs(gx)>this.cfg.flipThreshold)this.away=-Math.sign(gx);}
  tick(dt,input){
    const c=this.cfg;dt=Math.max(0,dt);this.time+=dt;
    const gx=Number.isFinite(input.gx)?input.gx:0,near=!!input.near,poke=!!input.poke,docked=input.docked!==false;
    let gesture;
    if(near||poke){this.lastAttention=this.time;this.lastWatch=this.time;}
    const attentive=this.time-this.lastWatch<c.attentiveWindow;
    const ignored=this.time-this.lastAttention>=c.ignoreAfter;
    if(!docked){ // free mode: no shuffling, hands are not drawn
      this.step=null;this.committed=0;this.headTarget=0;if(this.mode==='returning'||this.mode==='stepping')this.mode='rest';
    }
    // Pause the whole step, including hands and the head spring, until eyes reopen.
    this.held=!!input.hold;
    if(this.held){
      this.gazeDir=0;this.gazeTimer=0;
      if(this.mode==='sulk'){
        this.nearTimer=near?this.nearTimer+dt:0;
        if(poke||this.nearTimer>=c.sulkExitNear){this.mode='rest';this.nearTimer=0;this.lastAttention=this.time;return 'happy';}
      }
      return;
    }
    // advance an ongoing step
    if(this.step){
      const st=this.step;st.t+=dt;
      if(!st.headSet&&st.t>=c.headMoveAt){st.headSet=true;this.headTarget=st.to;}
      if(st.t>=c.stepDuration){this.committed=st.to;this.headTarget=st.to;this.step=null;this.lastStepEnd=this.time;}
    }
    if(this.mode==='sulk'){
      this.nearTimer=near?this.nearTimer+dt:0;
      if(poke||this.nearTimer>=c.sulkExitNear){
        this.mode='rest';this.nearTimer=0;this.gazeTimer=0;this.gazeDir=0;this.lastAttention=this.time;gesture='happy';
      }else if(gx*this.away>c.flipThreshold)this.away=-Math.sign(gx); // cursor moved to the side she faces: turn the other way
    }else{
      if(ignored&&!docked)this.enterSulk(gx);
      else if(ignored&&this.mode!=='returning'&&!this.step)this.mode='returning';
      if(this.mode==='returning'){
        if(!ignored)this.mode='rest';
        else if(!this.step){
          if(Math.abs(this.committed)<1e-6)this.enterSulk(gx);
          else if(this.time-this.lastStepEnd>=c.returnCooldown)this.beginStep(-Math.sign(this.committed),input.reduced);
        }
      }
      if(this.mode==='rest'||this.mode==='stepping'){
        // gaze driven stepping: the same direction must be held while she is being watched
        const dir=docked&&attentive&&Math.abs(gx)>c.gazeThreshold?Math.sign(gx):0;
        this.gazeTimer=dir!==0&&dir===this.gazeDir?this.gazeTimer+dt:0;
        this.gazeDir=dir;
        if(!this.step&&dir!==0&&this.gazeTimer>=c.gazeHold&&this.time-this.lastStepEnd>=c.cooldown&&Math.abs(this.committed+dir*c.stepSize)<=c.maxOffset+1e-6)this.beginStep(dir,input.reduced);
        this.mode=this.step?'stepping':'rest';
      }
    }
    this.returnT=this.mode==='returning'?this.returnT+dt:0;
    this.tickIdle(dt,!!input.reduced);
    this.head.step(this.headTarget,dt);
    if(this.reducedSnap){this.head.value=this.headTarget;this.head.velocity=0;this.reducedSnap=false;}
    return gesture;
  }
  tickIdle(dt,reduced){
    const c=this.cfg;this.reducedNow=reduced;
    this.idle.forEach((h,i)=>{
      if(reduced){h.tapT=-1;return;}
      h.phase+=dt*c.idleSqueezeHz[i]*Math.PI*2;
      if(h.tapT>=0){h.tapT+=dt;if(h.tapT>=c.tapDuration+c.tapLand)h.tapT=-1;}
      else if(!this.step&&this.time>=h.nextTap){h.tapT=0;h.nextTap=this.time+c.tapEvery[0]+this.random()*(c.tapEvery[1]-c.tapEvery[0]);}
    });
  }
  idleOf(i,reduced=false){
    const c=this.cfg,h=this.idle[i],u=h.tapT;
    if(reduced||!h)return {tap:0,tapSquash:0,squeeze:0};
    return {tap:u>=0&&u<c.tapDuration?Math.sin(Math.PI*u/c.tapDuration):0,tapSquash:u>=c.tapDuration?Math.sin(Math.PI*(u-c.tapDuration)/c.tapLand):0,squeeze:Math.sin(h.phase)};
  }
  snapshot(){
    const c=this.cfg,s=this.size;
    let hands=[0,1].map(i=>({x:this.committed*s,lift:0,rot:0,squash:0,...this.idleOf(i,this.reducedNow)})),roll=0,bob=0;
    const st=this.step;
    if(st){
      const u=st.t,lead=st.dir>0?1:0,trail=1-lead;
      const L=handPhase(u,LEAD,c.handRotation,st.dir,c),T=handPhase(u,TRAIL,c.handRotation*0.6,st.dir,c);
      const delta=st.to-st.from;
      hands[lead]={...hands[lead],x:(st.from+delta*L.move)*s,lift:L.lift*s,rot:L.rot,squash:L.squash};
      hands[trail]={...hands[trail],x:(st.from+delta*T.move)*s,lift:T.lift*s,rot:T.rot,squash:T.squash};
      const k=seg(u,c.headMoveAt-0.02,c.headMoveAt+0.4);
      roll=st.dir*c.headRoll*Math.sin(Math.PI*k);
      bob=(Math.sin(Math.PI*seg(u,c.headMoveAt,c.headMoveAt+0.34))+0.5*Math.sin(Math.PI*seg(u,LEAD.land,LEAD.land+0.14)))*c.headBob*s;
    }
    let override=null;
    if(this.mode==='sulk'){
      const a=this.away;
      override={gx:a*c.sulkGx,gy:c.sulkGy,yaw:a*c.sulkYaw,roll:a*c.sulkRoll,eyeCap:c.eyeCap,droop:1};
    }else if(this.mode==='returning')override={droop:c.returnDroopFrom+(c.returnDroopTo-c.returnDroopFrom)*clamp(this.returnT/c.returnDroopRamp,0,1)};
    return {offsetX:this.head.value*s,hands,override,mode:this.mode,roll,bob,held:this.held};
  }
}
