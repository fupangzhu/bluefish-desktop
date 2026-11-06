// Source-editor playback: deterministic setup, shared production Motion, no alternate animation renderer.
export const PREVIEWS={snub_l:4.5,snub_r:4.5,normal:6,rub_l:6,rub_r:6,peek:4,sleep:65,ear_l:1.2,ear_r:1.2,hair:7.2,hair_ltr:7.2,hair_rtl:7.2,breath:22,blink:1,fringe:3,tug_guard:2.5,bonk:4.1};
export class Preview{
 constructor(motion){this.motion=motion;this.active=false;this.playing=false;this.time=0;this.duration=0;this.rate=1;this.name='';}
 select(name){
  if(!Object.hasOwn(PREVIEWS,name))throw Error('Unknown preview');
  if(!this.active){const m=this.motion;this.original={follow:m.follow,idle:m.idle,wake:m.wake.random,doze:m.doze.random,lids:m.eyelids.random,reluctant:m.attention.reluctance.random};}
  this.basePose={...this.motion.pose};this.name=name;this.duration=PREVIEWS[name];this.rate=name.startsWith('ear_')?.25:name==='sleep'||name==='breath'?4:1;this.active=true;this.playing=true;this.initialize();
 }
 initialize(){
  const m=this.motion;m.attention.reluctance.random=this.original.reluctant;m.wake.random=()=>.5;m.doze.random=()=>.5;m.eyelids.random=()=>.5;m.reset();m.time=0;m.nextBlink=Infinity;m.pose={...this.basePose};m.follow=false;m.idle=true;m.override=null;
  for(const spring of Object.values(m.springs)){spring.value=0;spring.velocity=0;}this.time=0;
  if(this.name.startsWith('snub_')){
   m.attention.reluctance.random=()=>0;m.attention.droop=1;m.attention.lastNear=-30;m.springs.droop.value=1;m.springs.ears.value=-1;m.attention.update(0,{now:0});m.step(0);m.attention.update(0,{now:0,x:120,y:110,size:240,near:true,hx:this.name==='snub_l'?1:-1});m.step(0);
  }else if(!['blink','fringe','tug_guard','bonk'].includes(this.name)){
   const s=m.attention.sleepController;s.sleeping=true;s.closure=s.depth=1;m.attention.droop=1;m.springs.pitch.value=3;m.springs.droop.value=1;m.springs.ears.value=-1;m.attention.update(0,{now:0});m.step(0);
   m.doze.nextEar=m.doze.nextSide=Infinity;m.doze.breathPeriod=20;m.doze.swayPeriod=40;
   if(['normal','rub_l','rub_r','peek'].includes(this.name)){
    const draw=this.name==='normal'?.1:this.name==='rub_l'?.66:this.name==='rub_r'?.8:.95;m.wake.random=()=>draw;m.attention.update(0,{now:0,wake:true});m.step(0);
   }else if(this.name.startsWith('ear_'))m.doze.twitch(this.name.endsWith('l')?'l':'r');
   else if(this.name==='hair'||this.name.startsWith('hair_')){const from=this.name==='hair_rtl'?1:-1;m.doze.side=m.doze.sideTarget=m.doze.lean=from;m.springs.side.value=from;m.doze.nextSide=.3;m.step(0);}
   else if(this.name==='sleep'){m.doze.nextEar=20;m.doze.nextSide=35;}
  }else{m.attention.update(0,{now:0});m.step(0);if(this.name==='blink')m.blink();else if(this.name==='bonk')m.touch.startBonk();else if(this.name==='tug_guard')m.touch.startPull({x:0,y:0},{source:{x:1535,y:280},relative:true});else{m.idle=false;m.touch.fringe.start({x:0,y:0},240,{x:1100,y:1000});}}
 }
 advance(target){
  const m=this.motion;while(this.time<target-1e-8){const dt=Math.min(1/60,target-this.time);this.time+=dt;if(this.name==='fringe'){if(this.time<1.2){const u=Math.min(1,this.time/.7),k=u*u*(3-2*u);m.touch.fringe.move({x:14*k,y:-3*k});}else m.touch.fringe.end();}if(this.name==='tug_guard'){if(this.time<1.4){const u=Math.min(1,this.time/.55),k=u*u*(3-2*u);m.touch.movePull({x:15*k,y:-46*k},240);}else m.touch.endPull();}m.attention.update(dt,{now:this.time,reduced:m.reduced});m.step(dt);}
 }
 step(dt){if(this.active&&this.playing){this.advance(Math.min(this.duration,this.time+Math.max(0,dt)*this.rate));if(this.time>=this.duration-1e-8)this.playing=false;}return this.motion.current;}
 seek(time){if(!this.active)return;const playing=this.playing;this.initialize();this.advance(Math.max(0,Math.min(this.duration,time)));this.playing=playing&&this.time<this.duration;}
 release(){
  if(!this.active)return;const m=this.motion;if(this.name==='fringe')m.touch.fringe.end();if(this.name==='tug_guard')m.touch.endPull();m.wake.random=this.original.wake;m.doze.random=this.original.doze;m.eyelids.random=this.original.lids;m.attention.reluctance.random=this.original.reluctant;m.follow=this.original.follow;m.idle=this.original.idle;m.attention.lastClock=null;m.nextBlink=m.time+3;this.active=this.playing=false;
 }
 stop(){this.release();this.motion.reset();}
}
