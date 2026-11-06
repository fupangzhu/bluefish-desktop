import {Fringe} from './fringe.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const BONK_CHANCE=.35;
const DOUBLE_TAP=.42,BONK_END=3.78;
const screenPoint=p=>({x:p.sx??p.x,y:p.sy??p.y});
const motionDistance=(a,b)=>{const global=[a.sx,a.sy,b.sx,b.sy].every(Number.isFinite),p=global?screenPoint(a):a,q=global?screenPoint(b):b;return Math.hypot(p.x-q.x,p.y-q.y);};
const smooth=u=>{u=clamp(u,0,1);return u*u*(3-2*u);};

// Transient reactions are independent of idle gestures and never move the native window.
export class Touch {
  constructor(random=Math.random){this.random=random;this.reset();}
  reset(){this.fringe=new Fringe();this.time=0;this.anchor=null;this.target={x:0,y:0,pain:0};this.value={x:0,y:0,pain:0};this.ears={l:null,r:null};this.grab=null;this.idleTime=0;this.headTap=null;this.bonkAt=null;this.tugGuard=0;this.scheduleEar();}
  get bonking(){return this.bonkAt!==null;}
  startBonk(){if(this.bonking)return false;this.bonkAt=this.time;this.headTap=null;return true;}
  tapHead(point,size){
    if(this.bonking)return false;
    const last=this.headTap;this.headTap={point:{...point},time:this.time};
    if(!last||this.time-last.time>DOUBLE_TAP||motionDistance(point,last.point)>Math.max(12,size*.065))return false;
    this.headTap=null;
    return this.random()<BONK_CHANCE&&this.startBonk();
  }
  scheduleEar(){this.nextEarAt=this.idleTime+60+this.random()*60;}
  startPull(point,grip=null){
    this.anchor={x:point.x,y:point.y};this.target={x:0,y:0,pain:0};
    this.grab=grip?.source?{source:{...grip.source},binding:grip.binding?{...grip.binding}:null,baseOutline:grip.outline||null,relative:grip.relative||false,client:{...point},held:true,releasedAt:0,strength:1}:null;
    this.scheduleEar();
  }
  movePull(point,size){
    if(!this.anchor||!Number.isFinite(size)||size<=0)return;
    const x=(point.x-this.anchor.x)/size,y=(point.y-this.anchor.y)/size;
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    if(this.grab)this.grab.client={...point};
    this.target={x:clamp(x,-.12,.12),y:clamp(y,-.09,.12),pain:clamp((Math.hypot(x,y)-.018)/.14,0,1)};
  }
  endPull(){this.anchor=null;this.target={x:0,y:0,pain:0};if(this.grab){this.grab.held=false;this.grab.releasedAt=this.time;}}
  twitch(side,idle=false){
    if(side!=='l'&&side!=='r')return;
    const count=this.random()<.5?1:2;
    this.ears[side]={at:this.time,count:idle?1:count,amplitude:idle?.38:1,period:idle?.16:.115,idle};
    if(!idle)this.scheduleEar();return count;
  }
  step(dt,reduced=false,idle=true){
    dt=clamp(Number.isFinite(dt)?dt:0,0,.1);this.time+=dt;
    if(idle&&!reduced&&!this.anchor&&!this.fringe.held){
      this.idleTime+=dt;
      if(this.idleTime>=this.nextEarAt&&!this.ears.l&&!this.ears.r){
        const side=this.random()<.5?'l':'r';this.twitch(side,true);this.scheduleEar();
      }
    }
    if(this.grab&&!this.grab.held){
      const t=this.time-this.grab.releasedAt;
      this.grab.strength=reduced?Math.exp(-t*18):Math.exp(-t*11)*(Math.cos(t*17)+.32*Math.sin(t*17));
      if(t>=.65)this.grab=null;
    }
    for(const key of ['x','y','pain']){
      this.value[key]+=(this.target[key]-this.value[key])*(1-Math.exp(-dt*(this.anchor?36:14)));
      if(Math.abs(this.target[key]-this.value[key])<.0005)this.value[key]=this.target[key];
    }
    const fold=side=>{
      const ear=this.ears[side];if(!ear)return 0;
      const elapsed=this.time-ear.at,duration=reduced?.22:ear.count*ear.period+.045;
      if(elapsed>=duration){this.ears[side]=null;return 0;}
      if(reduced)return .22*Math.sin(Math.PI*elapsed/duration);
      if(elapsed>=ear.count*ear.period)return 0;
      const phase=elapsed%ear.period/ear.period;
      return ear.amplitude*Math.sin(Math.PI*phase)**2;
    };
    const guardTarget=this.anchor?smooth((this.value.pain-.03)/.32):0;
    this.tugGuard+=(guardTarget-this.tugGuard)*(1-Math.exp(-dt*(this.anchor?20:12)));
    if(this.tugGuard<.001)this.tugGuard=0;
    const bonkAge=this.bonking?this.time-this.bonkAt:Infinity;
    if(bonkAge>=BONK_END)this.bonkAt=null;
    const guard=this.bonking?smooth(bonkAge/.14)*(1-smooth((bonkAge-.76)/.32)):this.tugGuard;
    const duck=this.bonking?smooth((bonkAge-.28)/.32)*(1-smooth((bonkAge-3.3)/.48)):0;
    const pain=Math.max(this.value.pain,this.bonking?smooth(bonkAge/.08)*(1-smooth((bonkAge-.74)/.27)):0);
    const state={...this.fringe.step(dt,reduced),guard,duck,bonk:Number(this.bonking),pain,ahogePullX:this.value.x,ahogePullY:this.value.y,earFoldL:fold('l'),earFoldR:fold('r')};
    for(const side of ['l','r']){const ear=this.ears[side];if(ear&&!reduced)state[side==='l'?'earTwitchL':'earTwitchR']={elapsed:this.time-ear.at,count:ear.count,period:ear.period,amplitude:ear.amplitude};}
    if(this.grab)state.ahogeGrab={...this.grab};return state;
  }
}

// A tap on an ear reacts on release; a deliberate drag still moves the pet.
export class TouchInput {
  constructor(touch,onDrag=()=>{}){this.touch=touch;this.onDrag=onDrag;this.active=null;}
  begin(part,point,size,grip=null,{head=false}={}){
    if(this.active)return false;
    this.active={part:part||'body',point:{...point},size,head,moved:false,at:this.touch.time};
    if(!head)this.touch.headTap=null;
    if(part==='ahoge')this.touch.startPull(point,grip);
    else if(part==='hair_front')this.touch.fringe.start(point,size,grip?.source);
    else if(part!=='ear_l'&&part!=='ear_r')this.onDrag(true);
    return true;
  }
  move(point){
    const active=this.active;if(!active)return;
    if(motionDistance(point,active.point)>Math.max(5,active.size*.025)){active.moved=true;this.touch.headTap=null;}
    if(active.part==='ahoge')this.touch.movePull(point,active.size);
    else if(active.part==='hair_front')this.touch.fringe.move(point);
    else if(active.part.startsWith('ear_')&&Math.hypot(point.x-active.point.x,point.y-active.point.y)>Math.max(5,active.size*.025)){
      active.part='body';this.onDrag(true);
    }
  }
  hover(part,point,size,grip=null){this.touch.fringe.brush(!this.active&&part==='hair_front'?point:null,size,grip?.source);}
  end(cancel=false){
    const active=this.active;if(!active)return;
    this.active=null;
    if(active.part==='ahoge')this.touch.endPull();
    else if(active.part==='hair_front')this.touch.fringe.end();
    else if(active.part.startsWith('ear_')){if(!cancel)this.touch.twitch(active.part.slice(-1));}
    else this.onDrag(false);
    if(cancel||active.moved||this.touch.time-active.at>.45){this.touch.headTap=null;return false;}
    return active.head&&this.touch.tapHead(active.point,active.size);
  }
}
