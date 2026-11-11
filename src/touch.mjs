import {Fringe} from './fringe.mjs';
import {Dip,TOW,Tow} from './tow.mjs';
import {ahogeReach,bindAhoge} from './ahoge.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const BONK_CHANCE=.35;
const DOUBLE_TAP=.42,BONK_GUARD=1.1;   // the hands leave the head after BONK_GUARD; the shared duck finishes the bonk
const screenPoint=p=>({x:p.sx??p.x,y:p.sy??p.y});
const hasScreen=p=>Number.isFinite(p?.sx)&&Number.isFinite(p?.sy);
const motionDistance=(a,b)=>{const global=[a.sx,a.sy,b.sx,b.sy].every(Number.isFinite),p=global?screenPoint(a):a,q=global?screenPoint(b):b;return Math.hypot(p.x-q.x,p.y-q.y);};
const smooth=u=>{u=clamp(u,0,1);return u*u*(3-2*u);};

// Transient reactions are independent of idle gestures. Only a docked ahoge tow moves the
// native window, and only through the offset the overlay forwards to the main process.
export class Touch {
  constructor(random=Math.random){this.random=random;this.tow=new Tow();this.dip=new Dip(()=>this.random());this.reset();}
  reset(){this.fringe=new Fringe();this.tow.reset();this.dip.reset();this.towClient=null;this.towLean=0;this.towWince=0;this.time=0;this.anchor=null;this.target={x:0,y:0,pain:0};this.value={x:0,y:0,pain:0};this.ears={l:null,r:null};this.grab=null;this.idleTime=0;this.headTap=null;this.bonkAt=null;this.tugGuard=0;this.scheduleEar();}
  get bonking(){return this.bonkAt!==null;}
  startBonk(){if(this.bonking)return false;this.bonkAt=this.time;this.headTap=null;this.dip.start(0,'bonk');return true;}
  tapHead(point,size){
    if(this.bonking)return false;
    const last=this.headTap;this.headTap={point:{...point},time:this.time};
    if(!last||this.time-last.time>DOUBLE_TAP||motionDistance(point,last.point)>Math.max(12,size*.065))return false;
    this.headTap=null;
    return this.random()<BONK_CHANCE&&this.startBonk();
  }
  scheduleEar(){this.nextEarAt=this.idleTime+60+this.random()*60;}
  // tow: docked mode, where a sideways tug leads the whole pet along the taskbar.
  startPull(point,grip=null,{tow=false,size=240}={}){
    this.anchor={x:point.x,y:point.y};this.target={x:0,y:0,pain:0};
    this.towClient=null;this.dip.cancel();
    // The window moves under the pointer, so a tow is tracked in screen pixels only.
    if(tow&&hasScreen(point)&&this.tow.begin({x:point.sx,y:point.sy},size,grip?.source?ahogeReach(grip.binding||bindAhoge(grip.source)):undefined))this.towClient={x:point.x,y:point.y};
    else this.tow.reset();
    this.grab=grip?.source?{source:{...grip.source},binding:grip.binding?{...grip.binding}:null,baseOutline:grip.outline||null,relative:grip.relative||false,client:{...point},held:true,releasedAt:0,strength:1}:null;
    this.scheduleEar();
  }
  movePull(point,size){
    if(!this.anchor||!Number.isFinite(size)||size<=0)return;
    if(this.tow.active){if(hasScreen(point))this.tow.move({x:point.sx,y:point.sy});return;}
    const x=(point.x-this.anchor.x)/size,y=(point.y-this.anchor.y)/size;
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    if(this.grab)this.grab.client={...point};
    this.target={x:clamp(x,-.12,.12),y:clamp(y,-.09,.12),pain:clamp((Math.hypot(x,y)-.018)/.14,0,1)};
  }
  endPull(){if(!this.anchor)return;this.tow.release(this.lastReduced);this.anchor=null;this.target={x:0,y:0,pain:0};if(this.grab){this.grab.held=false;this.grab.releasedAt=this.time;}}
  // Lifted too high: the strand slips out of the fingers and springs back.
  slip(){
    if(!this.anchor)return;
    this.anchor=null;this.target={x:0,y:0,pain:0};
    if(this.grab){this.grab.held=false;this.grab.releasedAt=this.time;this.grab.slip=true;}
    for(const side of ['l','r'])this.ears[side]={at:this.time,count:1,amplitude:.7,period:.13,idle:false};
  }
  twitch(side,idle=false){
    if(side!=='l'&&side!=='r')return;
    const count=this.random()<.5?1:2;
    this.ears[side]={at:this.time,count:idle?1:count,amplitude:idle?.38:1,period:idle?.16:.115,idle};
    if(!idle)this.scheduleEar();return count;
  }
  step(dt,reduced=false,idle=true){
    dt=clamp(Number.isFinite(dt)?dt:0,0,.1);this.time+=dt;this.lastReduced=reduced;
    let towEnd=null,towSlip=false,leanTarget=0,winceTarget=0;
    if(this.tow.busy||this.tow.pendingEnd){
      const o=this.tow.step(dt,reduced),size=this.tow.size;towEnd=o.ended;
      if(this.anchor&&this.towClient){
        this.target={x:clamp(o.stretch/size,-.16,.16),y:clamp(o.dy/size,-.2,.12),pain:.85*smooth((o.height-TOW.warn)/(TOW.lift-TOW.warn))};
        if(this.grab)this.grab.client={x:this.towClient.x+o.stretch,y:this.towClient.y+o.dy};
      }
      if(o.slip){towSlip=true;this.slip();}
      if(o.engaged&&(o.active||this.tow.gliding)){
        leanTarget=clamp(o.velocity/(size*3),-1,1);
        if(o.active)winceTarget=.3+.7*smooth(Math.abs(o.velocity)/(size*2.5));
      }else if(o.active)winceTarget=.3*smooth((o.ratio-.9)/.14);   // the strand going taut tugs at the scalp

    }
    if(towEnd&&towEnd.traveled>=TOW.dipAfter)this.dip.start(towEnd.dir);
    const follow=1-Math.exp(-dt*(reduced?20:8));
    this.towLean+=(leanTarget-this.towLean)*follow;this.towWince+=(winceTarget-this.towWince)*follow;
    if(Math.abs(this.towLean)<1e-3&&!leanTarget)this.towLean=0;if(this.towWince<1e-3&&!winceTarget)this.towWince=0;
    if(idle&&!reduced&&!this.anchor&&!this.fringe.held){
      this.idleTime+=dt;
      if(this.idleTime>=this.nextEarAt&&!this.ears.l&&!this.ears.r){
        const side=this.random()<.5?'l':'r';this.twitch(side,true);this.scheduleEar();
      }
    }
    if(this.grab&&!this.grab.held){
      const t=this.time-this.grab.releasedAt;
      // A slipped strand swings back with a looser, longer wobble.
      const slip=!!this.grab.slip;
      this.grab.strength=reduced?Math.exp(-t*18):Math.exp(-t*(slip?6.5:11))*(Math.cos(t*(slip?19:17))+.32*Math.sin(t*(slip?19:17)));
      if(t>=(slip?.95:.65))this.grab=null;
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
    const guardTarget=this.anchor&&!this.towClient?smooth((this.value.pain-.03)/.32):0;
    this.tugGuard+=(guardTarget-this.tugGuard)*(1-Math.exp(-dt*(this.anchor?20:12)));
    if(this.tugGuard<.001)this.tugGuard=0;
    const bonkAge=this.bonking?this.time-this.bonkAt:Infinity;
    if(bonkAge>=BONK_GUARD&&!this.dip.active)this.bonkAt=null;
    const guard=this.bonking?smooth(bonkAge/.14)*(1-smooth((bonkAge-.76)/.32)):this.tugGuard;
    const pain=Math.max(this.value.pain,this.bonking?smooth(bonkAge/.08)*(1-smooth((bonkAge-.74)/.27)):0);
    const state={...this.fringe.step(dt,reduced),guard,bonk:Number(this.bonking),pain,ahogePullX:this.value.x,ahogePullY:this.value.y,earFoldL:fold('l'),earFoldR:fold('r'),towing:Number(this.tow.engaged&&this.tow.busy),towLean:this.towLean,towWince:this.towWince,towSlip:Number(towSlip),...this.dip.step(dt,reduced)};
    if(towEnd)state.towEnd=towEnd;
    for(const side of ['l','r']){const ear=this.ears[side];if(ear&&!reduced)state[side==='l'?'earTwitchL':'earTwitchR']={elapsed:this.time-ear.at,count:ear.count,period:ear.period,amplitude:ear.amplitude};}
    if(this.grab)state.ahogeGrab={...this.grab};return state;
  }
}

// A tap on an ear reacts on release; a deliberate drag still moves the pet.
// How far a press on the fringe may travel before it turns into carrying the whole character.
export const TOUCH_HANDOFF={hair:.12};
export class TouchInput {
  constructor(touch,onDrag=()=>{}){this.touch=touch;this.onDrag=onDrag;this.active=null;}
  begin(part,point,size,grip=null,{head=false,tow=false}={}){
    if(this.active)return false;
    this.active={part:part||'body',point:{...point},size,head,moved:false,at:this.touch.time};
    if(!head)this.touch.headTap=null;
    if(part==='ahoge')this.touch.startPull(point,grip,{tow,size});
    else if(part==='hair_front')this.touch.fringe.start(point,size,grip?.source);
    else if(part!=='ear_l'&&part!=='ear_r')this.onDrag(true);
    return true;
  }
  move(point){
    const active=this.active;if(!active)return;
    if(motionDistance(point,active.point)>Math.max(5,active.size*.025)){active.moved=true;this.touch.headTap=null;}
    if(active.part==='ahoge')this.touch.movePull(point,active.size);
    else if(active.part==='hair_front'){
      // A small pull flicks the fringe (it saturates at ~6% of the head); pulling well past that
      // means the owner wants to carry her, so the press becomes a window drag.
      if(Math.hypot(point.x-active.point.x,point.y-active.point.y)>Math.max(16,active.size*TOUCH_HANDOFF.hair)){this.touch.fringe.end();this.touch.headTap=null;active.part='body';active.moved=true;this.onDrag(true);}
      else this.touch.fringe.move(point);
    }
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
