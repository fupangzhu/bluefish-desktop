// Leaning limply against a screen edge and zoning out for a while.
// Pure state machine; the wall side comes from the window position.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=u=>{u=clamp(u,0,1);return u*u*(3-2*u);};

export const SLUMP={
  arriveChance:.5,     // chance after being dropped next to a wall
  arriveDelay:[.8,1.5],// seconds of settling before deciding
  idleChance:.3,       // chance per idle check while resting at a wall
  idleEvery:[30,60],   // seconds between idle checks
  in:1.2,              // slow, heavy lean
  hold:[6,12],         // zoning out
  out:.9,              // perking up again
  quick:.35            // interrupted by a touch or by leaving the wall
};

export class Slump{
  constructor(random=Math.random){this.random=random;this.reset();}
  reset(){this.time=0;this.phase=null;this.side=0;this.t=0;this.hold=0;this.exitFrom=0;this.exitLength=SLUMP.out;this.pendingAt=null;this.nextIdleAt=null;this.mix=0;}
  get active(){return this.phase!==null;}
  between([a,b]){return a+(b-a)*clamp(this.random(),0,1);}
  // Called when the pet has just been dropped somewhere; decides after it settles.
  arrive(extraDelay=0){this.pendingAt=this.time+Math.max(0,extraDelay)+this.between(SLUMP.arriveDelay);}
  // A direct touch wakes her from it and cancels any pending decision.
  poke(){this.pendingAt=null;this.nextIdleAt=null;this.leave(SLUMP.quick);}
  begin(side){this.phase='in';this.side=side;this.t=0;this.hold=this.between(SLUMP.hold);}
  leave(length){if(this.phase&&this.phase!=='out'){this.phase='out';this.exitFrom=this.mix;this.exitLength=length;this.t=0;}}
  step(dt,{wall=0,enabled=true,busy=false}={}){
    dt=clamp(Number.isFinite(dt)?dt:0,0,.1);this.time+=dt;
    wall=Math.sign(wall)||0;
    if(!enabled){this.pendingAt=null;this.nextIdleAt=null;this.leave(SLUMP.quick);}
    else if(this.phase&&this.phase!=='out'&&wall!==this.side)this.leave(SLUMP.quick);
    else if(!this.phase&&!busy){
      if(this.pendingAt!==null&&this.time>=this.pendingAt){
        this.pendingAt=null;this.nextIdleAt=null;
        if(wall&&this.random()<SLUMP.arriveChance)this.begin(wall);
      }else if(this.pendingAt===null){
        if(!wall)this.nextIdleAt=null;
        else if(this.nextIdleAt===null)this.nextIdleAt=this.time+this.between(SLUMP.idleEvery);
        else if(this.time>=this.nextIdleAt){
          this.nextIdleAt=null;
          if(this.random()<SLUMP.idleChance)this.begin(wall);
        }
      }
    }
    if(busy&&!this.phase)this.nextIdleAt=null;
    if(this.phase){
      this.t+=dt;
      if(this.phase==='in'){this.mix=smooth(this.t/SLUMP.in);if(this.t>=SLUMP.in){this.phase='hold';this.t=0;}}
      else if(this.phase==='hold'){this.mix=1;if(this.t>=this.hold)this.leave(SLUMP.out);}
      else{this.mix=this.exitFrom*(1-smooth(this.t/this.exitLength));if(this.t>=this.exitLength){this.phase=null;this.mix=0;this.side=0;}}
    }
    return {slump:this.mix,slumpSide:this.mix>0?this.side:0};
  }
}
