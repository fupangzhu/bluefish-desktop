const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const unit=(x,y)=>{const length=Math.hypot(x,y)||1;return {x:x/length,y:y/length};};
const lerp=(a,b,t)=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)});

// Source-art centreline, from the fixed root around the curl to its free tip.
const SPINE=[[1143.222,503.018],[1138,452],[1146,390],[1167,320],[1198,255],[1243,202],[1300,167],[1364,151],[1428,155],[1483,180],[1522,221],[1538,268],[1527,316],[1495,365]].map(([x,y])=>({x,y}));
function resample(points,count){
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+distance(points[i],points[i-1]));
  return Array.from({length:count},(_,i)=>{
    const d=i/(count-1)*lengths.at(-1);let k=0;while(k<points.length-2&&lengths[k+1]<d)k++;
    return lerp(points[k],points[k+1],(d-lengths[k])/(lengths[k+1]-lengths[k]));
  });
}
export const AHOGE_REST=resample(SPINE,40);
function sample(curve,t){const i=Math.min(curve.length-2,Math.floor(t));return lerp(curve[i],curve[i+1],t-i);}
function tangent(curve,t){
  const a=sample(curve,clamp(t-.6,0,curve.length-1)),b=sample(curve,clamp(t+.6,0,curve.length-1));
  return unit(b.x-a.x,b.y-a.y);
}
export function bindAhoge(point){
  let best=Infinity,t=0;
  for(let i=0;i<AHOGE_REST.length-1;i++){
    const a=AHOGE_REST[i],b=AHOGE_REST[i+1],dx=b.x-a.x,dy=b.y-a.y;
    const u=clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy),0,1),q=lerp(a,b,u),d=distance(point,q);
    if(d<best){best=d;t=i+u;}
  }
  const center=sample(AHOGE_REST,t),dir=tangent(AHOGE_REST,t),dx=point.x-center.x,dy=point.y-center.y;
  return {t,along:dx*dir.x+dy*dir.y,across:-dx*dir.y+dy*dir.x};
}
function mapped(binding,curve,pinch=0,gripT=0){
  const p=sample(curve,binding.t),dir=tangent(curve,binding.t);
  const width=1-.24*pinch*Math.exp(-(((binding.t-gripT)/1.3)**2));
  return {x:p.x+dir.x*binding.along-dir.y*binding.across*width,y:p.y+dir.y*binding.along+dir.x*binding.across*width};
}
export function deformAhoge(binding,pose){
  if(!pose)return mapped(binding,AHOGE_REST);
  const p=mapped(binding,pose.curve,pose.pinch,pose.gripT);
  // Preserve the exact material point held between the fingers, even off-centre.
  const root=pose.rootIndex,weight=binding.t<=root?0:binding.t<pose.gripT?(binding.t-root)/(pose.gripT-root):1;
  return {x:p.x+pose.correction.x*weight,y:p.y+pose.correction.y*weight};
}

export function solveAhoge(source,target,{strength=1,held=true,base=AHOGE_REST}={}){
  const grip=bindAhoge(source),g=Math.max(.12,grip.t),last=Math.min(base.length-2,Math.ceil(g)-1);
  // The lower stem is held in the hairband; bending begins above that attachment.
  const rootIndex=Math.min(9,Math.max(0,last-1)),root=base[rootIndex],end=sample(base,g);
  const prefix=base.slice(rootIndex,last+1);prefix.push(end);
  const arc=[0];for(let i=1;i<prefix.length;i++)arc.push(arc[i-1]+distance(prefix[i-1],prefix[i]));
  const length=Math.max(.1,arc.at(-1)),restChord=Math.max(.1,distance(root,end)),axis=unit(end.x-root.x,end.y-root.y);
  const gripOffset=mapped(grip,base),wanted={x:target.x-(gripOffset.x-end.x),y:target.y-(gripOffset.y-end.y)};
  const requested=distance(root,wanted),direction=requested>.001?unit(wanted.x-root.x,wanted.y-root.y):axis;
  // Slack first straightens; the pin follows exactly through the elastic range,
  // then the length limit provides resistance instead of unlimited rubber scaling.
  const stretch=clamp(requested-length,0,.18*length);
  const chord=Math.max(.01,Math.min(requested,length)+stretch);
  let straight=clamp((chord-restChord)/Math.max(.1,length-restChord),0,1);
  const offsets=prefix.map(p=>{const x=p.x-root.x,y=p.y-root.y;return {along:x*axis.x+y*axis.y,across:-x*axis.y+y*axis.x};});
  let along;
  const arcLength=amplitude=>{let sum=0;for(let i=1;i<prefix.length;i++)sum+=Math.hypot(along[i]-along[i-1],(offsets[i].across-offsets[i-1].across)*amplitude);return sum;};
  // Blend out longitudinal backtracking in the curl as it becomes taut.
  for(let i=0;i<12;i++){
    along=offsets.map((p,j)=>mix(p.along/restChord*chord,arc[j]/length*chord,straight));
    if(arcLength(0)<=Math.max(length,chord)+.0001)break;straight+=(1-straight)*.5;
  }
  let amplitude=0;
  if(chord<length-.0001){
    let lo=0,hi=1;while(arcLength(hi)<length&&hi<16)hi*=2;
    for(let i=0;i<22;i++){const mid=(lo+hi)/2;if(arcLength(mid)<length)lo=mid;else hi=mid;}amplitude=(lo+hi)/2;
  }
  const solved=prefix.map((p,i)=>({x:root.x+direction.x*along[i]-direction.y*offsets[i].across*amplitude,y:root.y+direction.y*along[i]+direction.x*offsets[i].across*amplitude}));
  const curve=base.map(p=>({...p}));
  for(let i=rootIndex;i<=last;i++)curve[i]=solved[i-rootIndex];
  // The ungripped tail follows the tangent at the pinch, retaining its own curl.
  const tip=solved.at(-1),before=solved.at(-2)||root,oldDir=tangent(base,g),newDir=unit(tip.x-before.x,tip.y-before.y);
  const cos=oldDir.x*newDir.x+oldDir.y*newDir.y,sin=oldDir.x*newDir.y-oldDir.y*newDir.x;
  for(let i=last+1;i<curve.length;i++){const dx=base[i].x-end.x,dy=base[i].y-end.y;curve[i]={x:tip.x+cos*dx-sin*dy,y:tip.y+sin*dx+cos*dy};}
  // A fractional grip lies within a mesh segment: keep that interpolated centre pinned.
  if(g>last+.00001&&last+1<curve.length){const f=g-last;curve[last+1]={x:(tip.x-(1-f)*curve[last].x)/f,y:(tip.y-(1-f)*curve[last].y)/f};}
  const pose={curve,gripT:grip.t,rootIndex,pinch:held?Math.max(0,strength):0,correction:{x:0,y:0},phase:stretch>0?'stretch':straight>.08?'straighten':'drag',stretch:stretch/length,length};
  const actual=mapped(grip,curve,pose.pinch,grip.t),capped={x:tip.x+gripOffset.x-end.x,y:tip.y+gripOffset.y-end.y};
  pose.correction={x:capped.x-actual.x,y:capped.y-actual.y};
  // Release springs the deformed centreline back to the original art, with a small overshoot.
  if(strength!==1){pose.curve=curve.map((p,i)=>lerp(AHOGE_REST[i],p,strength));pose.correction.x*=strength;pose.correction.y*=strength;}
  return pose;
}
