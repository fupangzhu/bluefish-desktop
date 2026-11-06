import test from 'node:test';
import assert from 'node:assert/strict';
import {Tow,TOW,Dip,DIP} from '../src/tow.mjs';
import {TAUT} from '../src/ahoge.mjs';
import {Slump,SLUMP} from '../src/slump.mjs';
import {Touch,TouchInput} from '../src/touch.mjs';
import {Motion} from '../src/motion.mjs';

const S=240;
const run=(tow,seconds,reduced=false)=>{let out,ended=null,slip=false;for(let i=0;i<Math.ceil(seconds*120);i++){out=tow.step(1/120,reduced);if(out.ended)ended=out.ended;if(out.slip)slip=true;}return {...out,ended,slip};};

// Pointer x (relative to the grab) that puts the rope at a given ratio of its length, to the right.
const at=(tow,ratio)=>Math.sqrt((ratio*tow.length)**2-tow.root.y**2)-tow.root.x+tow.offset;

test('pull, then straighten, then drag away: the head only moves once the strand is taut',()=>{
  const tow=new Tow();tow.begin({x:1000,y:900},S);
  assert.ok(tow.length>S*.25&&tow.length<S*.4,'the tip grip has a strand of about a third of the head');
  assert.ok(run(tow,.1).ratio<TAUT.from,'at rest the curl is shorter than its strand');
  for(const ratio of [TAUT.from-.02,(TAUT.from+TAUT.to)/2,TAUT.engage-.01]){
    tow.move({x:1000+at(tow,ratio),y:900});const o=run(tow,.4);
    assert.equal(o.engaged,false);assert.equal(o.offset,0,'bending and straightening never move the head: '+ratio);
  }
  tow.move({x:1000+at(tow,TAUT.engage+.02),y:900});assert.equal(run(tow,.05).engaged,true);
  // Drag 300px to the right: the strand stays taut but never stretches past its limit.
  const from=tow.offset;
  for(let i=1;i<=60;i++){tow.move({x:1000+at(tow,1)-tow.offset+from+5*i,y:900});const o=run(tow,1/60);assert.ok(o.ratio<=TAUT.max+1e-6,'never past the longest strand');}
  assert.ok(tow.offset>250,'followed the drag');
});

test('the stretched strand pulls the head past its rest length when the pointer stops, but never pushes',()=>{
  const settle=reduced=>{
    const tow=new Tow();tow.begin({x:0,y:0},S);
    for(let i=1;i<=60;i++){tow.move({x:8*i,y:0});tow.step(1/60,reduced);}
    let o;for(let i=0;i<240;i++)o=tow.step(1/120,reduced);return {tow,ratio:o.ratio};
  };
  const springy=settle(false),calm=settle(true);
  assert.ok(springy.ratio<.99&&springy.ratio>TAUT.from,'coasts a little into slack: '+springy.ratio);
  assert.ok(calm.ratio>springy.ratio,'reduced motion does not overshoot');
  // Bringing the pointer back over the head slackens the strand: the head is not pushed away.
  const tow=springy.tow,before=tow.offset;tow.move({x:tow.cursor.x-60,y:0});run(tow,.5);
  assert.ok(tow.offset<=before+1e-6);
});

test('lifting the ahoge above its reach makes it slip; release glides briefly and reports the travel',()=>{
  const tow=new Tow();tow.begin({x:0,y:500},S);
  const lift=h=>500-(h*tow.length+tow.root.y);   // pointer y for a root -> pointer height of h strand lengths
  tow.move({x:0,y:lift(TOW.lift-.03)});assert.equal(run(tow,.2).slip,false);
  tow.move({x:0,y:lift(TOW.lift+.01)});const slipped=run(tow,1);
  assert.equal(slipped.slip,true);assert.equal(tow.active,false);assert.equal(slipped.ended?.slipped,true);

  const glide=new Tow();glide.begin({x:0,y:0},S);
  for(let i=1;i<=40;i++){glide.move({x:i*12,y:0});run(glide,1/60);}
  const before=glide.offset;glide.release();
  const after=run(glide,1);
  assert.ok(after.offset>before,'keeps sliding in the drag direction');
  assert.ok(after.offset-before<S*.3,'glide is short');
  assert.ok(after.ended&&after.ended.traveled>TOW.dipAfter&&after.ended.dir===1);
});

test('screen-edge limits stop the head; pulling hard against the edge slips',()=>{
  const tow=new Tow();tow.begin({x:500,y:0},S);tow.setLimits(-50,50);
  tow.move({x:500-180,y:0});const held=run(tow,1);
  assert.equal(held.offset,-50);assert.equal(held.slip,false);
  tow.move({x:500-50-tow.root.x-TOW.wallSlip*tow.length-2,y:0});assert.equal(run(tow,.1).slip,true);
});

test('the duck sinks to a set depth, rises slowly without any bounce, and swings the ahoge a couple of times',()=>{
  const dip=new Dip(()=>.5);dip.start(1);
  let max=0,min=Infinity,prev=0,trend=0,downAt=null,riseFrom=null,upAt=null,last=0;const peaks=[];
  for(let i=0;i<720;i++){
    const t=(i+1)/120,o=dip.step(1/120);max=Math.max(max,o.dip);if(dip.active)min=Math.min(min,o.dip);
    if(downAt===null&&o.dip>=DIP.depth*.9)downAt=t;
    if(riseFrom===null&&o.dip<last-1e-6)riseFrom=t;
    if(riseFrom!==null&&upAt===null&&o.dip<=DIP.depth*.1)upAt=t;
    last=o.dip;
    const d=Math.sign(o.ahogeSway-prev);if(trend&&d&&d!==trend&&Math.abs(prev)>2)peaks.push(prev);if(d)trend=d;prev=o.ahogeSway;
  }
  assert.ok(max<=DIP.depth+1e-9,'never sinks past the set depth: '+max);
  assert.ok(DIP.depth>.065&&DIP.depth<.8,'between the old shallow duck and the full hide');
  assert.ok(min>=0,'never pops above rest');
  assert.equal(dip.active,false);
  assert.ok(upAt-riseFrom>2*downAt,'rising is much slower than sinking: '+[downAt,upAt-riseFrom]);
  // Sinking leaves the tip behind (up), stopping throws it down, then it swings back with decay.
  assert.ok(peaks.length>=4,'swings: '+peaks.map(p=>p.toFixed(1)));
  assert.ok(peaks[0]<-6&&peaks[1]>8&&peaks[2]<0&&Math.abs(peaks[2])<Math.abs(peaks[1])&&Math.abs(peaks[3])<Math.abs(peaks[2]));
  assert.ok(peaks.every(p=>Math.abs(p)<=DIP.sway.limit));

  const quick=new Dip(()=>0);quick.start(-1);for(let i=0;i<60;i++)quick.step(1/120);
  quick.cancel();let left=0;while(quick.active&&left<2){quick.step(1/120);left+=1/120;}
  assert.ok(left<=.8,'a cancel rises quickly: '+left);

  const calm=new Dip(()=>.5);calm.start(1);let sway=0;for(let i=0;i<600;i++)sway=Math.max(sway,Math.abs(calm.step(1/120,true).ahogeSway));
  assert.equal(sway,0,'reduced motion: no swinging');
});

test('touch: a docked tow never shows the angry face or guard, then always ends in the duck',()=>{
  const touch=new Touch(()=>.5),drags=[],input=new TouchInput(touch,on=>drags.push(on));
  const at=(x,y)=>({x,y,sx:x+1000,sy:y+800});
  input.begin('ahoge',at(100,50),S,{source:{x:1300,y:200}},{tow:true});
  let max={pain:0,guard:0,wince:0};
  for(let i=1;i<=90;i++){input.move(at(100+i*4,50));const s=touch.step(1/60);max={pain:Math.max(max.pain,s.pain),guard:Math.max(max.guard,s.guard),wince:Math.max(max.wince,s.towWince)};}
  assert.ok(max.pain<.08,'no >< eyes while being towed');assert.equal(max.guard,0);assert.ok(max.wince>.3);
  assert.deepEqual(drags,[],'the tow does not use the body drag');
  assert.ok(touch.tow.offset>200);
  input.end();
  let dipped=false;for(let i=0;i<240;i++){const s=touch.step(1/120);if(s.dip>.05)dipped=true;}
  assert.ok(dipped,'moving always ends in the duck');
});

test('touch: lifting during a tow slips the strand with a looser rebound and an ear flick',()=>{
  const touch=new Touch(()=>.5);
  touch.startPull({x:100,y:100,sx:100,sy:100},{source:{x:1300,y:200}},{tow:true,size:S});
  touch.movePull({x:100,y:100-S*.25,sx:100,sy:100-S*.25},S);
  const s=touch.step(1/60);
  assert.equal(s.towSlip,1);assert.equal(touch.anchor,null);assert.ok(s.ahogeGrab.slip&&!s.ahogeGrab.held);
  assert.ok(touch.ears.l&&touch.ears.r);
  // The rebound outlasts an ordinary release.
  for(let i=0;i<48;i++)touch.step(1/60);assert.ok(touch.grab,'still swinging after .8s');
});

test('free mode keeps the protective tug reaction',()=>{
  const touch=new Touch();touch.startPull({x:80,y:60});touch.movePull({x:100,y:5},S);
  let s;for(let i=0;i<120;i++)s=touch.step(1/120);
  assert.ok(s.pain>.9&&s.guard>.5);assert.equal(s.towing,0);
});

test('slump: dropped next to a wall it may lean there, a touch or leaving the wall ends it',()=>{
  const lean=new Slump(()=>0);lean.arrive();
  let out;for(let i=0;i<240;i++)out=lean.step(1/60,{wall:-1});
  assert.equal(out.slumpSide,-1);assert.ok(out.slump>.9);
  lean.poke();for(let i=0;i<30;i++)out=lean.step(1/60,{wall:-1});assert.equal(out.slump,0);

  const away=new Slump(()=>0);away.begin(1);for(let i=0;i<120;i++)away.step(1/60,{wall:1});
  for(let i=0;i<30;i++)out=away.step(1/60,{wall:0});assert.equal(out.slump,0);

  const unlucky=new Slump(()=>.99);unlucky.arrive();for(let i=0;i<240;i++)out=unlucky.step(1/60,{wall:1});assert.equal(out.slump,0);
  const middle=new Slump(()=>0);middle.arrive();for(let i=0;i<240;i++)out=middle.step(1/60,{wall:0});assert.equal(out.slump,0);
});

test('slump: waits while busy, idles into it now and then, and runs its full course',()=>{
  const lean=new Slump(()=>0);lean.arrive();
  for(let i=0;i<300;i++)assert.equal(lean.step(1/60,{wall:1,busy:true}).slump,0);
  let peak=0,length=0;for(let i=0;i<60*20;i++){const o=lean.step(1/60,{wall:1});peak=Math.max(peak,o.slump);if(o.slump>0)length+=1/60;}
  assert.equal(peak,1);assert.ok(length>=SLUMP.in+SLUMP.hold[0]&&length<=SLUMP.in+SLUMP.hold[1]+SLUMP.out+.1);

  const idle=new Slump(()=>0);let started=null;
  for(let t=0;t<SLUMP.idleEvery[1]+1&&started===null;t+=1/10)if(idle.step(1/10,{wall:-1}).slump>0)started=t;
  assert.ok(started!==null&&started>=SLUMP.idleEvery[0]-.2);
  const off=new Slump(()=>0);off.arrive();for(let i=0;i<300;i++)assert.equal(off.step(1/60,{wall:1,enabled:false}).slump,0);
});

test('motion: the slump rests the head on the wall side with half-closed, unfocused eyes',()=>{
  for(const side of [-1,1]){
    const m=new Motion(()=>0);m.follow=false;m.wall={side,gap:30};m.slump.begin(side);
    for(let i=0;i<240;i++)m.step(1/60);
    const c=m.current;
    assert.equal(c.slumpSide,side);assert.ok(c.slump>.99);
    assert.ok(Math.sign(c.roll)===side&&Math.abs(c.roll)>6);
    assert.ok(c.left<=.43&&c.right<=.43);assert.ok(c.ahogeDroop>.8);
    assert.ok(m.blocksTravel(),'no taskbar shuffling while slumped');
  }
  const reduced=new Motion(()=>0);reduced.reduced=true;reduced.wall={side:1,gap:30};reduced.slump.arrive();
  for(let i=0;i<300;i++)reduced.step(1/60);assert.equal(reduced.current.slump,0,'reduced motion disables idle slumping');
});
