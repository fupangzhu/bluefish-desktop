// One vector definition supplies the editable SVG, WebGL stroke and material bindings.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const unit=(x,y)=>{const n=Math.hypot(x,y)||1;return {x:x/n,y:y/n};};
const lerp=(a,b,t)=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)});
// The same endpoint poses connect through the lower arc around the fixed root.
export const ahogeRestAngle=(droop,side=1)=>clamp(droop,0,1)*(160-85*clamp(side,-1,1))||0;
export const AHOGE_ROOT={x:1143.222,y:503.018};
export const AHOGE_COLORS={top:[65,105,231],root:[39,76,193]};
// Five-control quadratic B-spline. The two simple knots preserve a continuous
// tangent, while fewer free controls keep the outline broad and uncomplicated.
export const AHOGE_DEGREE=2;
const KNOTS=[0,0,0,1/3,2/3,1,1,1];
const CONTROL=[[1143.222,503.018],[1068.222,293.018],[1336.7885,92.9332],[1541.3577,225.3975],[1495,365]].map(([x,y])=>({x,y}));
function spline(points,t,degree=AHOGE_DEGREE,knots=KNOTS){
 t=clamp(t,0,1);let span=degree;while(span<points.length-1&&t>=knots[span+1])span++;
 const d=Array.from({length:degree+1},(_,i)=>({...points[span-degree+i]}));
 for(let r=1;r<=degree;r++)for(let j=degree;j>=r;j--){const k=span-degree+j,a=(t-knots[k])/(knots[j+1+span-r]-knots[k]);d[j]=lerp(d[j-1],d[j],a);}
 return d[degree];
}
function derivative(points,t){const d=points.slice(0,-1).map((p,i)=>{const f=AHOGE_DEGREE/(KNOTS[i+AHOGE_DEGREE+1]-KNOTS[i+1]);return {x:(points[i+1].x-p.x)*f,y:(points[i+1].y-p.y)*f};});return spline(d,t,AHOGE_DEGREE-1,KNOTS.slice(1,-1));}
const RADII=[2.8,30,40,32,0];
const EDGES=[-1,1].map(side=>CONTROL.map((p,i)=>{const a=CONTROL[Math.max(0,i-1)],b=CONTROL[Math.min(CONTROL.length-1,i+1)],n=unit(a.y-b.y,b.x-a.x);return {x:p.x+n.x*RADII[i]*side,y:p.y+n.y*RADII[i]*side};}));
export const AHOGE_REST=Array.from({length:80},(_,i)=>spline(CONTROL,i/79));
export const ahogeEdges=t=>EDGES.map(points=>spline(points,t));
export function ahogeWidth(t){const [a,b]=ahogeEdges(t);return distance(a,b)/2;}
// The material coordinate is shared by both outlines and the rendered mesh.
const LAST=AHOGE_REST.length-1;
const center=(left,right)=>lerp(left,right,.5);
function bindingAt(point,t){
 const u=t/LAST,p=spline(CONTROL,u),d=derivative(CONTROL,u),dir=unit(d.x,d.y),dx=point.x-p.x,dy=point.y-p.y;
 return {t,along:dx*dir.x+dy*dir.y,across:-dx*dir.y+dy*dir.x};
}
export function bindAhoge(point){
 let best=Infinity,t=0;
 for(let i=0;i<LAST;i++){const a=AHOGE_REST[i],b=AHOGE_REST[i+1],dx=b.x-a.x,dy=b.y-a.y,u=clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy),0,1),q=lerp(a,b,u),d=distance(point,q);if(d<best){best=d;t=i+u;}}
 return bindingAt(point,t);
}
export function deformAhoge(binding,pose){
 const t=binding.t/LAST,outline=pose?.outline||EDGES;
 if(Number.isFinite(binding.u))return lerp(spline(outline[0],t),spline(outline[1],t),binding.u);
 const p=center(spline(outline[0],t),spline(outline[1],t)),d=derivative(CONTROL,t),dir=unit(d.x,d.y),along=binding.along||0,across=binding.across||0;
 return {x:p.x+dir.x*along-dir.y*across,y:p.y+dir.y*along+dir.x*across};
}

const SAMPLES=96;
const basis=t=>CONTROL.map((_,k)=>spline(CONTROL.map((_,j)=>({x:j===k?1:0,y:0})),t).x);
const evalPoint=(controls,b)=>controls.reduce((p,q,i)=>({x:p.x+b[i]*q.x,y:p.y+b[i]*q.y}),{x:0,y:0});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const turn=(a,b)=>Math.abs(Math.atan2(cross(a,b),dot(a,b)));
const len=p=>Math.hypot(p.x,p.y);
const ROWS=Array.from({length:SAMPLES+1},(_,i)=>{
 const t=i/SAMPLES;
 return {b:basis(t),rest:ahogeEdges(t)};
});
function ribbonRows(outline){
 return ROWS.map(row=>outline.map(edge=>evalPoint(edge,row.b)));
}
const reference=[];
let restLength=0;
for(let i=1;i<=SAMPLES;i++){
 const a=ROWS[i-1].rest,b=ROWS[i].rest,steps=b.map((p,j)=>sub(p,a[j]));
 const length=len(center(...steps));
 restLength+=length;
 reference.push({steps,length,total:restLength,signs:[cross(sub(a[1],a[0]),steps[0]),cross(steps[1],sub(b[0],a[1]))]});
}
function outlineStretch(outline){
 const rows=ribbonRows(outline);
 let total=0,stretch=0,prior=null;
 for(let i=1;i<=SAMPLES;i++){
  const a=rows[i-1],b=rows[i],steps=b.map((p,j)=>sub(p,a[j])),ref=reference[i-1];
  const signs=[cross(sub(a[1],a[0]),steps[0]),cross(steps[1],sub(b[0],a[1]))];
  if(signs.some((area,j)=>Math.abs(ref.signs[j])>.001&&area*ref.signs[j]<=0))return null;
  for(let j=0;j<2;j++){
   if(len(steps[j])<.36*len(ref.steps[j]))return null;
   if(prior&&turn(prior[j],steps[j])>Math.max(.085,1.6*turn(reference[i-2].steps[j],ref.steps[j])))return null;
  }
  total+=len(center(...steps));prior=steps;
  stretch=Math.max(stretch,total/ref.total-1);
  if(stretch>.18)return null;
 }
 return stretch;
}
// Shared control motion preserves the cross-section and the tip tangent. A
// near-root pin has little leverage: stop at the first safe deformation.
const INFLUENCE=[0,0,.55,1,1];
const moveOutline=(outline,dx,dy)=>outline.map(edge=>edge.map((p,i)=>({x:p.x+dx*INFLUENCE[i],y:p.y+dy*INFLUENCE[i]})));
function lastSafe(candidate,max){
 let best=candidate(0),stretch=outlineStretch(best)??0,low=0;
 for(let i=1;i<=8;i++){
  const step=max*i/8,outline=candidate(step),check=outlineStretch(outline);
  if(check!==null){best=outline;stretch=check;low=step;continue;}
  let high=step;
  for(let j=0;j<12;j++){
   const mid=(low+high)/2,next=candidate(mid),value=outlineStretch(next);
   if(value===null)high=mid;else{low=mid;best=next;stretch=value;}
  }
  break;
 }
 return {outline:best,stretch,fraction:low};
}
// Released, the strand springs back to its rest curl. strength runs 1 -> 0 with a decaying
// oscillation; below 0 it swings past rest (the curl tightens). That overshoot is capped at a
// fixed distance: an extrapolation proportional to a long pull (e.g. a fully straightened
// strand) would coil the curl into a spiral.
const OVERSHOOT=35;   // art px, largest control displacement past rest (the curl tightens a few degrees)
// Blend two outlines by turning each control around the fixed root (angle and distance) instead of
// moving it in a straight line: between a straight strand and the curl, straight-line blends pass
// through a loop; turning about the root uncurls and recurls the strand without one. Each control's
// half-width vector turns with it. f=0 gives a, f=1 gives b; f<0 extrapolates past a.
const angleOf=v=>Math.atan2(v.y,v.x),turnVec=(v,a)=>({x:v.x*Math.cos(a)-v.y*Math.sin(a),y:v.x*Math.sin(a)+v.y*Math.cos(a)});
function curlBlend(a,b,f){
 const ca=a[0].map((p,i)=>lerp(p,a[1][i],.5)),cb=b[0].map((p,i)=>lerp(p,b[1][i],.5));
 const centre=[],half=[];
 for(let i=0;i<ca.length;i++){
  const va=sub(ca[i],AHOGE_ROOT),vb=sub(cb[i],AHOGE_ROOT),ra=len(va),rb=len(vb);
  let d=ra>1e-6&&rb>1e-6?angleOf(vb)-angleOf(va):0;d=Math.atan2(Math.sin(d),Math.cos(d));
  const r=mix(ra,rb,f),ang=ra>1e-6?angleOf(va)+d*f:angleOf(vb);
  centre.push(r>1e-6?{x:AHOGE_ROOT.x+Math.cos(ang)*r,y:AHOGE_ROOT.y+Math.sin(ang)*r}:lerp(ca[i],cb[i],f));
  const ha=turnVec(sub(a[1][i],ca[i]),d*f),hb=turnVec(sub(b[1][i],cb[i]),-d*(1-f));
  half.push({x:ha.x*(1-f)+hb.x*f,y:ha.y*(1-f)+hb.y*f});
 }
 return [centre.map((p,i)=>sub(p,half[i])),centre.map((p,i)=>({x:p.x+half[i].x,y:p.y+half[i].y}))];
}
export function reboundAhoge(pose,strength){
 const blend=f=>EDGES.map((edge,j)=>edge.map((p,i)=>lerp(p,pose.outline[j][i],f)));
 let f=strength;
 if(f<0){const reach=Math.max(...pose.outline.flatMap((edge,j)=>edge.map((p,i)=>distance(p,EDGES[j][i]))));if(reach*-f>OVERSHOOT)f=-OVERSHOOT/reach;}
 // A straightened strand recurls about its root, never snapping even where the strict curl checks object.
 if(pose.taut>=.5){const outline=curlBlend(EDGES,pose.outline,f);return {...pose,outline,stretch:outlineStretch(outline)??Math.max(0,f)*(pose.stretch||0)};}
 const outline=blend(f),stretch=outlineStretch(outline);
 if(stretch!==null)return {...pose,outline,stretch};
 const safe=lastSafe(g=>blend(g*f),1);
 return {...pose,outline:safe.outline,stretch:safe.stretch};
}
// Pulling a pinched point away from the root runs through three phases, measured against the
// strand length from the root to that point along the rest curl (its "reach"):
//   bend      below TAUT.from: the curl only bends under the pointer;
//   straighten TAUT.from..TAUT.to: the curl straightens into a line toward the pointer;
//   taut      beyond TAUT.to: a straight, slightly elastic strand, up to TAUT.max of its length.
// A docked tow starts moving the head at TAUT.engage (src/tow.mjs uses the same numbers).
export const TAUT={from:.7,to:1,engage:1.04,max:1.1};
const smoothstep=u=>{u=clamp(u,0,1);return u*u*(3-2*u);};
// Rest arc length along the centre line, tabulated by spline parameter.
const ARC=(()=>{const n=960,out=[0];let total=0,prev=spline(CONTROL,0);for(let i=1;i<=n;i++){const p=spline(CONTROL,i/n);total+=distance(prev,p);prev=p;out.push(total);}return out;})();
const arcAt=u=>{const x=clamp(u,0,1)*(ARC.length-1),i=Math.min(ARC.length-2,Math.floor(x));return mix(ARC[i],ARC[i+1],x-i);};
// Collinear controls whose spline reproduces the rest arc-length distribution, so a straightened
// strand keeps every material point at its own distance from the root (least squares, c0 = 0).
const STRAIGHT=(()=>{
 const m=4,A=Array.from({length:m},()=>Array(m+1).fill(0));
 for(let j=0;j<=96;j++){const u=j/96,b=basis(u).slice(1),y=arcAt(u);for(let r=0;r<m;r++){for(let c=0;c<m;c++)A[r][c]+=b[r]*b[c];A[r][m]+=b[r]*y;}}
 for(let i=0;i<m;i++){let p=i;for(let r=i+1;r<m;r++)if(Math.abs(A[r][i])>Math.abs(A[p][i]))p=r;[A[i],A[p]]=[A[p],A[i]];for(let r=0;r<m;r++)if(r!==i){const f=A[r][i]/A[i][i];for(let c=i;c<=m;c++)A[r][c]-=f*A[i][c];}}
 return [0,...A.map((row,i)=>row[m]/row[i])];
})();
function straightOutline(dir,scale){
 const n={x:-dir.y,y:dir.x};
 return [-1,1].map(side=>STRAIGHT.map((c,i)=>({x:AHOGE_ROOT.x+dir.x*c*scale+n.x*RADII[i]*side,y:AHOGE_ROOT.y+dir.y*c*scale+n.y*RADII[i]*side})));
}
// Rest vector from the root to a material point, and the strand length to it.
export function ahogeReach(binding){
 const t=clamp(binding.t/LAST,0,1),p=deformAhoge(binding,{outline:EDGES});
 return {x:p.x-AHOGE_ROOT.x,y:p.y-AHOGE_ROOT.y,arc:arcAt(t)};
}
export function solveAhoge(source,target,{strength=1,baseOutline=EDGES,binding=null}={}){
 const grip=binding||bindAhoge(source),t=clamp(grip.t/LAST,0,1),start=deformAhoge(grip,{outline:baseOutline}),delta=sub(target,start),d=len(delta);
 const leverage=basis(t).reduce((sum,w,i)=>sum+w*INFLUENCE[i],0);
 const cap=d>1e-8?Math.min(1,restLength*.65*leverage/d):0;
 const result=cap>0?lastSafe(f=>moveOutline(baseOutline,delta.x*f/leverage,delta.y*f/leverage),cap):{outline:baseOutline,stretch:outlineStretch(baseOutline)??0,fraction:0};
 const saturated=d>1e-8&&result.fraction<.999;
 let pose={outline:result.outline,stretch:result.stretch,saturated,phase:saturated?'resist':'bend',taut:0};
 // Straightening is measured from where the grab began, so re-pinching a pulled strand keeps its shape.
 const arc=Math.max(arcAt(t),1e-6),away=sub(target,AHOGE_ROOT),reach=len(away),ratio=reach/arc;
 const from=Math.max(TAUT.from,len(sub(start,AHOGE_ROOT))/arc),taut=smoothstep((ratio-from)/Math.max(.05,TAUT.to-from));
 if(taut>0&&reach>1e-6){
  // The pinch may sit off the centre line: turn and size the line until that point is under the pointer.
  let dir={x:away.x/reach,y:away.y/reach},scale=Math.min(ratio,TAUT.max),straight=straightOutline(dir,scale);
  for(let k=0;k<3;k++){
   const g=sub(deformAhoge(grip,{outline:straight}),AHOGE_ROOT),gl=len(g)||1,a=Math.atan2(cross(g,away),dot(g,away)),c=Math.cos(a),s=Math.sin(a);
   dir={x:dir.x*c-dir.y*s,y:dir.x*s+dir.y*c};scale=Math.min(scale*reach/gl,TAUT.max);straight=straightOutline(dir,scale);
  }
  let outline=taut>=1?straight:curlBlend(pose.outline,straight,taut);
  // Mid-way the bent pose may already resist, so the blend can drift off the pointer: nudge the free
  // controls (root fixed) until the pinch is back under it.
  const over=ratio>TAUT.max;
  if(!over&&taut<1&&leverage>1e-6)for(let k=0;k<4;k++){const e=sub(target,deformAhoge(grip,{outline}));if(len(e)<.05)break;outline=moveOutline(outline,e.x/leverage,e.y/leverage);}
  pose={outline,stretch:Math.max(0,scale-1),saturated:over,phase:over?'resist':taut>=1?'taut':'straighten',taut};
 }
 return strength===1?pose:reboundAhoge(pose,strength);
}
export function ahogeGeometry(segments=256){
 const rows=[],points=[];
 for(let i=0;i<=segments;i++){const u=i/segments;rows.push(ahogeEdges(u).map((p,k)=>[p.x,p.y,k,u,{...bindingAt(p,u*(AHOGE_REST.length-1)),u:k}]));}
 for(let i=0;i<segments;i++)points.push(rows[i][0],rows[i][1],rows[i+1][0],rows[i][1],rows[i+1][1],rows[i+1][0]);return points;
}
export function ahogeBounds(){const p=ahogeGeometry();return [Math.floor(Math.min(...p.map(p=>p[0])))-2,Math.floor(Math.min(...p.map(p=>p[1])))-2,Math.ceil(Math.max(...p.map(p=>p[0])))+2,Math.ceil(Math.max(...p.map(p=>p[1])))+2];}
function svgSegments(points){
 return [0,1/3,2/3].map(a=>{const b=a+1/3,p=spline(points,a),q=spline(points,b),d=derivative(points,a),h=(b-a)/2;return [p,{x:p.x+d.x*h,y:p.y+d.y*h},q];});
}
export function ahogeSVG(){
 const f=p=>p.x.toFixed(4)+' '+p.y.toFixed(4),left=svgSegments(EDGES[0]),right=svgSegments(EDGES[1]),curve=c=>'Q'+f(c[1])+' '+f(c[2]);
 const path='M'+f(left[0][0])+left.map(curve).join('')+right.toReversed().map(c=>curve(c.toReversed())).join('')+'Z';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048"><defs><linearGradient id="blue" gradientUnits="userSpaceOnUse" x1="0" y1="140" x2="0" y2="505"><stop stop-color="rgb(${AHOGE_COLORS.top})"/><stop offset="1" stop-color="rgb(${AHOGE_COLORS.root})"/></linearGradient></defs><path fill="url(#blue)" d="${path}"/></svg>`;
}
