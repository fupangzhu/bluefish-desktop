import test from 'node:test';import assert from 'node:assert/strict';
import {Attention} from '../src/attention.mjs';import {Motion} from '../src/motion.mjs';
const point={x:120,y:110,size:240,near:true,overHead:true,hx:0,hy:0};
const dt=1/60;
const rub=(a,m,i)=>{const x=Math.sin(i*dt*5);const s=a.update(dt,{...point,x:120+32*x,hx:x,hy:Math.sin(i*dt*3)*.2});m?.step(dt);return s;};
const leave=(a,m,i=0)=>{const s=a.update(dt,{...point,overHead:false,near:false,x:400+i});m?.step(dt);return s;};

test('a new rub selects sleepy / playful / subtle in roughly 20 / 50 / 30 proportions',()=>{
 let seed=321,count=0;const a=new Attention(()=>{count++;seed=(1664525*seed+1013904223)>>>0;return seed/2**32;});
 const totals={sleepy:0,playful:0,subtle:0};
 for(let n=0;n<1000;n++){
  for(let i=0;i<18;i++)rub(a,null,i);totals[a.current.reaction]++;
  for(let i=0;i<60;i++)leave(a,null,i);
 }
 assert.equal(count,1000);assert.ok(totals.sleepy>=150&&totals.sleepy<=250);assert.ok(totals.playful>=450&&totals.playful<=550);assert.ok(totals.subtle>=250&&totals.subtle<=350);
});

test('one reaction stays fixed through continuous rubbing and brief edge crossings',()=>{
 let calls=0;const a=new Attention(()=>++calls===1?.4:.9);
 for(let i=0;i<300;i++)rub(a,null,i);assert.equal(calls,1);assert.equal(a.current.reaction,'playful');
 for(let i=0;i<12;i++)leave(a);for(let i=0;i<60;i++)rub(a,null,i);assert.equal(calls,1);assert.equal(a.current.reaction,'playful');
 for(let i=0;i<60;i++)leave(a);for(let i=0;i<60;i++)rub(a,null,i);assert.equal(calls,2);assert.equal(a.current.reaction,'subtle');
 a.reset();assert.equal(a.current.reaction,null);
});

test('playful rubbing keeps eyes open and wags the ahoge; subtle rubbing only sways a little',()=>{
 const peaks={};
 for(const [reaction,draw] of [['sleepy',.1],['playful',.4],['subtle',.85]]){
  const m=new Motion(()=>draw);m.idle=false;let yaw=0,roll=0,wag=0;
  for(let i=0;i<360;i++){
   rub(m.attention,m,i);if(i<90)continue;
   yaw=Math.max(yaw,Math.abs(m.current.yaw));roll=Math.max(roll,Math.abs(m.current.roll));wag=Math.max(wag,Math.abs(m.current.ahogeWag));
   if(reaction!=='sleepy')assert.equal(Math.min(m.current.left,m.current.right),1);
  }
  assert.equal(m.current.rubReaction,reaction);peaks[reaction]={yaw,roll,wag};
  if(reaction==='sleepy'){assert.ok(m.current.left<.01&&m.current.right<.01);assert.ok(Math.abs(m.current.yaw)<.05);}
 }
 assert.ok(peaks.playful.wag>4);assert.equal(peaks.subtle.wag,0);assert.ok(peaks.playful.yaw>peaks.subtle.yaw*2);assert.ok(peaks.subtle.yaw<2);assert.ok(peaks.subtle.roll<1);
});

test('open-eye reactions do not inherit a delayed wake or movement freeze on departure',()=>{
 for(const draw of [.4,.85]){
  const m=new Motion(()=>draw);m.idle=false;m.setGaze(.9,0);
  for(let i=0;i<300;i++)rub(m.attention,m,i);
  assert.equal(m.wakePending,false);leave(m.attention,m);assert.equal(m.attention.restUntil,0);assert.equal(m.blocksTravel(),false);
  for(let i=0;i<120;i++)leave(m.attention,m,i);assert.ok(m.current.left>.99&&m.current.right>.99);assert.ok(m.current.yaw>5);assert.ok(Math.abs(m.current.ahogeWag)<.01);
 }
});

test('a new playful session gently reopens previously sleepy eyes before the head starts moving',()=>{
 const m=new Motion(()=>.5);m.idle=false;let sessions=0;m.attention.pickReaction=()=>++sessions===1?'sleepy':'playful';
 for(let i=0;i<300;i++)rub(m.attention,m,i);for(let i=0;i<60;i++)leave(m.attention,m);
 const yaw=m.current.yaw;rub(m.attention,m,0);assert.equal(m.current.rubReaction,'playful');assert.ok(m.current.left>0&&m.current.left<.2);assert.ok(m.wakePending);
 let opened=false,changed=false;
 for(let i=1;i<240;i++){
  rub(m.attention,m,i);opened||=m.current.left===1&&m.current.right===1;
  if(!opened){assert.equal(m.current.yaw,yaw);assert.equal(m.current.ahogeWag,0);}
  if(Math.abs(m.current.yaw-yaw)>.1){assert.ok(opened);changed=true;}
 }
 assert.ok(opened&&changed);assert.equal(sessions,2);assert.equal(m.attention.restUntil,0);
});

test('reduced motion disables lively head and ahoge oscillations; reset clears wag inertia',()=>{
 const m=new Motion(()=>.4);m.idle=false;m.reduced=true;
 for(let i=0;i<300;i++){rub(m.attention,m,i);assert.equal(m.current.ahogeWag,0);assert.equal(m.current.yaw,0);assert.equal(m.current.roll,0);assert.equal(m.current.left,1);}
 m.reduced=false;for(let i=0;i<120;i++)rub(m.attention,m,i);assert.notEqual(m.springs.wag.value,0);m.reset();m.step(dt);assert.equal(m.current.ahogeWag,0);
});
