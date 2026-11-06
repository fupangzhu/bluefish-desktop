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
export function reboundAhoge(pose,strength){
 const blend=f=>EDGES.map((edge,j)=>edge.map((p,i)=>lerp(p,pose.outline[j][i],f)));
 const outline=blend(strength),stretch=outlineStretch(outline);
 if(stretch!==null)return {...pose,outline,stretch};
 const safe=lastSafe(f=>blend(f*strength),1);
 return {...pose,outline:safe.outline,stretch:safe.stretch};
}
export function solveAhoge(source,target,{strength=1,baseOutline=EDGES,binding=null}={}){
 const grip=binding||bindAhoge(source),t=clamp(grip.t/LAST,0,1),start=deformAhoge(grip,{outline:baseOutline}),delta=sub(target,start),d=len(delta);
 const leverage=basis(t).reduce((sum,w,i)=>sum+w*INFLUENCE[i],0);
 const cap=d>1e-8?Math.min(1,restLength*.65*leverage/d):0;
 const result=cap>0?lastSafe(f=>moveOutline(baseOutline,delta.x*f/leverage,delta.y*f/leverage),cap):{outline:baseOutline,stretch:outlineStretch(baseOutline)??0,fraction:0};
 const saturated=d>1e-8&&result.fraction<.999,pose={outline:result.outline,stretch:result.stretch,saturated,phase:saturated?'resist':'bend'};
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
