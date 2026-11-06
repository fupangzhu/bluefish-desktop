// Ahoge-led travel along the taskbar, plus the duck that follows it.
// Pure state machines: screen pixels in, window offset and expression values out.
import {TAUT,ahogeReach,bindAhoge} from './ahoge.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=u=>{u=clamp(u,0,1);return u*u*(3-2*u);};

// The pinched ahoge is an elastic rope from its fixed root to the pointer. Its natural length is
// the strand length from the root to the pinched point (see TAUT in ahoge.mjs): the curl first
// bends, then straightens, and only past TAUT.engage does the head start to follow. The rope
// pulls but never pushes, so a slack strand lets the head slide to a stop.
// Ratios are of that rope length; times in seconds.
export const TOW={
  warn:.85,      // the pointer this far above/below the root starts to hurt
  lift:1.06,     // ...and this far the strand slips out of the grip (the head only moves sideways)
  wallSlip:1.3,  // pulled this far against a screen edge also slips
  omega:20,      // stiffness (rad/s) of the stretched strand pulling the head
  zeta:.45,      // its damping: below 1, so the head overshoots a little into slack
  slide:9,       // per-second friction of the head sliding while the strand is slack
  glide:11,      // per-second velocity decay after release
  stopSpeed:8,   // px/s below which a glide ends
  dipAfter:.12   // travel (x avatar size) that always ends in a duck
};
const ART_TO_PX=1.76/4096;   // renderer.project: 2048 art px span 1.76 clip units, i.e. .88 of the avatar size
const TIP_REACH=ahogeReach(bindAhoge({x:1535,y:280}));

export class Tow{
  constructor(){this.reset();}
  reset(){this.active=false;this.engaged=false;this.gliding=false;this.offset=0;this.velocity=0;this.start=null;this.cursor=null;this.size=240;this.min=-Infinity;this.max=Infinity;this.traveled=0;this.slipped=false;this.dir=0;this.pendingEnd=null;this.root={x:0,y:0};this.length=1;}
  get busy(){return this.active||this.gliding;}
  // point: pointer position in screen pixels at the grab. reach: ahogeReach() of the pinched point (art px).
  begin(point,size,reach=TIP_REACH){
    this.reset();
    if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return false;
    this.active=true;this.size=Number.isFinite(size)&&size>0?size:240;this.start={x:point.x,y:point.y};this.cursor={...this.start};
    const k=this.size*ART_TO_PX;this.root={x:reach.x*k,y:reach.y*k};this.length=Math.max(.06*this.size,reach.arc*k);   // root -> pinch at rest; rope length (a pinch at the root still needs a short pull)
    return true;
  }
  // Allowed window offsets relative to the window position at the grab.
  setLimits(min,max){if(Number.isFinite(min)&&Number.isFinite(max)&&min<=max){this.min=min;this.max=max;}}
  move(point){if(this.active&&Number.isFinite(point?.x)&&Number.isFinite(point?.y))this.cursor={x:point.x,y:point.y};}
  release(reduced=false){
    if(!this.active)return;
    this.active=false;
    this.gliding=this.engaged&&!reduced&&Math.abs(this.velocity)>TOW.stopSpeed;
    if(!this.gliding)this.finish();
  }
  finish(){this.gliding=false;this.velocity=0;this.pendingEnd={traveled:this.traveled/this.size,slipped:this.slipped,dir:this.dir};}
  limit(){
    if(this.offset<this.min){this.offset=this.min;if(this.velocity<0)this.velocity=0;}
    if(this.offset>this.max){this.offset=this.max;if(this.velocity>0)this.velocity=0;}
  }
  // Root -> pointer in screen px (the head, and so the root, moves only sideways).
  rope(){const x=this.root.x+this.cursor.x-this.start.x-this.offset,y=this.root.y+this.cursor.y-this.start.y;return {x,y,r:Math.hypot(x,y)};}
  step(dt,reduced=false){
    dt=clamp(Number.isFinite(dt)?dt:0,0,.1);
    const out={slip:false,ended:null},L=this.length;
    if(this.active){
      if(!this.engaged&&this.rope().r>=TAUT.engage*L)this.engaged=true;
      if(this.engaged){
        const w=TOW.omega,z=reduced?1:TOW.zeta,n=Math.max(1,Math.ceil(dt*240)),h=dt/n,longest=TAUT.max*L;
        for(let i=0;i<n;i++){
          let R=this.rope();
          const taut=R.r>L,pull=taut?w*w*(R.r-L)*R.x/R.r:0;
          this.velocity+=(pull-(taut?2*z*w:TOW.slide)*this.velocity)*h;
          const before=this.offset;this.offset+=this.velocity*h;
          // Fully stretched, the strand drags the head along rigidly.
          R=this.rope();
          if(R.r>longest&&Math.abs(R.y)<longest)this.offset=this.root.x+this.cursor.x-this.start.x-Math.sign(R.x)*Math.sqrt(longest*longest-R.y*R.y);
          this.limit();
          this.traveled+=Math.abs(this.offset-before);
        }
        if(Math.abs(this.velocity)>1)this.dir=Math.sign(this.velocity);
      }
      const R=this.rope();
      if(Math.abs(R.y)>=TOW.lift*L||R.r>=TOW.wallSlip*L){this.slipped=true;out.slip=true;this.release(reduced);}
    }else if(this.gliding){
      const before=this.offset;
      this.velocity*=Math.exp(-TOW.glide*dt);this.offset+=this.velocity*dt;this.limit();
      this.traveled+=Math.abs(this.offset-before);
      if(Math.abs(this.velocity)<TOW.stopSpeed)this.finish();
    }
    if(this.pendingEnd){out.ended=this.pendingEnd;this.pendingEnd=null;}
    const dx=this.cursor?this.cursor.x-this.start.x:0,dy=this.cursor?this.cursor.y-this.start.y:0,R=this.cursor?this.rope():{y:this.root.y,r:Math.hypot(this.root.x,this.root.y)};
    return {...out,active:this.active,engaged:this.engaged,offset:this.offset,velocity:this.velocity,stretch:dx-this.offset,dy,ratio:R.r/L,height:Math.abs(R.y)/L};
  }
}

// One duck behind the taskbar edge, shared by a bonk and a tow: sink, stay down, rise slowly.
// The head follows critically damped springs, so it never sinks past the set depth nor pops
// above rest, and the rise is much slower than the sink. It never fades out. The ahoge is a
// damped pendulum driven by the head's vertical acceleration: the sink starts and stops it
// swinging back and forth a couple of times.
export const DIP={
  depth:.3,                       // fraction of the head hidden below the ledge (eyes go under, ears and ahoge stay up)
  delay:{tow:0,bonk:.85},         // a bonk first covers the head; she drops as the hands return to the ledge
  hold:{tow:[1.3,2.3],bonk:[1.8,2.6]},
  settle:.45,                     // time the sink takes before the hold counts
  down:11,up:4.2,quick:12,        // spring frequencies (rad/s): ~.45 s down, ~1.2 s up; grabbed again: back up in ~.6 s
  sway:{omega:2*Math.PI*2.3,zeta:.12,gain:150,limit:20}   // ahoge: ~2.3 Hz, two visible swings, capped
};
export class Dip{
  constructor(random=Math.random){this.random=random;this.y=0;this.v=0;this.reset();this.sway=0;this.swayVelocity=0;}
  reset(){this.active=false;this.t=0;this.hold=0;this.dir=0;this.kind='tow';this.delay=0;this.holdEnd=Infinity;this.quick=false;}
  get remaining(){return this.active?Math.max(0,this.holdEnd-this.t)+1.2:0;}
  start(dir=0,kind='tow'){
    const hold=DIP.hold[kind]||DIP.hold.tow;
    this.active=true;this.t=0;this.quick=false;this.kind=kind==='bonk'?'bonk':'tow';this.dir=Math.sign(dir)||0;
    this.delay=DIP.delay[this.kind];this.hold=hold[0]+(hold[1]-hold[0])*clamp(this.random(),0,1);
    this.holdEnd=this.delay+DIP.settle+this.hold;
  }
  // Rise early from wherever the duck currently is.
  cancel(){if(this.active&&this.t<this.holdEnd){this.holdEnd=this.t;this.quick=true;}}
  step(dt,reduced=false){
    dt=clamp(Number.isFinite(dt)?dt:0,0,.1);
    const n=Math.max(1,Math.ceil(dt*240)),h=dt/n,sw=DIP.sway;
    for(let i=0;i<n;i++){
      let accel=0;
      if(this.active){
        this.t+=h;
        const goal=this.t>=this.delay&&this.t<this.holdEnd?DIP.depth:0,w=goal>this.y?DIP.down:this.quick?DIP.quick:DIP.up;
        accel=w*w*(goal-this.y)-2*w*this.v;
        this.v+=accel*h;this.y=clamp(this.y+this.v*h,0,DIP.depth);
        if(this.t>this.holdEnd&&this.y<.0015&&Math.abs(this.v)<.01){this.y=0;this.v=0;this.active=false;}
      }
      // Head accelerating down leaves the tip behind (swings up, negative); stopping throws it down.
      if(reduced){this.sway=0;this.swayVelocity=0;continue;}
      const a=-sw.omega*sw.omega*this.sway-2*sw.zeta*sw.omega*this.swayVelocity-sw.gain*accel;
      this.swayVelocity+=a*h;this.sway=clamp(this.sway+this.swayVelocity*h,-sw.limit,sw.limit);
      if(Math.abs(this.sway)<.01&&Math.abs(this.swayVelocity)<.05){this.sway=0;this.swayVelocity=0;}
    }
    const mix=this.active?clamp(this.y/DIP.depth*1.4,0,1):0;
    return {dip:this.active?this.y:0,dipMix:mix,dipDir:this.active?this.dir:0,dipKind:this.active&&this.kind==='bonk'?1:0,ahogeSway:this.sway};
  }
}
