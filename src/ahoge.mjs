// One vector definition supplies the editable SVG, WebGL stroke and material bindings.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const unit=(x,y)=>{const n=Math.hypot(x,y)||1;return {x:x/n,y:y/n};};
const lerp=(a,b,t)=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)});
const ease=t=>{t=clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);};
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
// Dense material samples also use degree two; no cubic interpolation is hidden
// beneath the quadratic visible outline.
const MATERIAL_KNOTS=new Map();
function sample(curve,t){
 const n=curve.length;
 if(!MATERIAL_KNOTS.has(n))MATERIAL_KNOTS.set(n,[0,0,0,...Array.from({length:n-3},(_,i)=>(i+1)/(n-2)),1,1,1]);
 return spline(curve,t/(n-1),AHOGE_DEGREE,MATERIAL_KNOTS.get(n));
}
function tangent(curve,t){t=clamp(t,0,curve.length-1);const a=sample(curve,Math.max(0,t-.02)),b=sample(curve,Math.min(curve.length-1,t+.02));return unit(b.x-a.x,b.y-a.y);}
function bindingAt(point,t){const center=sample(AHOGE_REST,t),dir=tangent(AHOGE_REST,t),dx=point.x-center.x,dy=point.y-center.y;return {t,along:dx*dir.x+dy*dir.y,across:-dx*dir.y+dy*dir.x};}
export function bindAhoge(point){
 let best=Infinity,t=0;
 for(let i=0;i<AHOGE_REST.length-1;i++){const a=AHOGE_REST[i],b=AHOGE_REST[i+1],dx=b.x-a.x,dy=b.y-a.y,u=clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy),0,1),q=lerp(a,b,u),d=distance(point,q);if(d<best){best=d;t=i+u;}}
 return bindingAt(point,t);
}
function mapped(binding,curve,pinch=0,gripT=0){
 const p=sample(curve,binding.t),dir=tangent(curve,binding.t),width=1-.06*pinch*Math.exp(-(((binding.t-gripT)/2)**2));
 return {x:p.x+dir.x*binding.along-dir.y*binding.across*width,y:p.y+dir.y*binding.along+dir.x*binding.across*width};
}
const weight=(t,root,g)=>g>root?ease((t-root)/(g-root)):0;
export function deformAhoge(binding,pose){
 if(pose?.outline&&Number.isFinite(binding.u)){const t=binding.t/(AHOGE_REST.length-1);return lerp(spline(pose.outline[0],t),spline(pose.outline[1],t),binding.u);}
 if(!pose)return mapped(binding,AHOGE_REST);
 const p=mapped(binding,pose.curve,pose.pinch,pose.gripT),w=weight(binding.t,pose.rootIndex,pose.gripT);
 return {x:p.x+pose.correction.x*w,y:p.y+pose.correction.y*w};
}
function prefixLength(curve,root,g){let sum=0;for(let i=root+1;i<=Math.floor(g);i++)sum+=distance(curve[i-1],curve[i]);return sum+distance(curve[Math.floor(g)],sample(curve,g));}
function smoothEnough(curve){
 for(let i=2;i<curve.length-1;i++){
  const a=curve[i-1],b=curve[i],c=curve[i+1],ab=distance(a,b),bc=distance(b,c),dot=((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))/Math.max(.0001,ab*bc);
  if(dot<.6)return false;
  const radius=(ab+bc)/Math.max(.0001,4*Math.sqrt(Math.max(0,(1-dot)/2)));
  if(radius<ahogeWidth(i/(curve.length-1))*1.3)return false;
 }return true;
}
export function solveAhoge(source,target,{strength=1,held=true,base=AHOGE_REST,binding=null,attempt=0}={}){
 const grip=binding||bindAhoge(source),g=Math.max(.12,grip.t),rootIndex=Math.min(2,Math.max(0,Math.floor(g)-1)),length=Math.max(.1,prefixLength(base,rootIndex,g));
 const start=mapped(grip,base),delta={x:target.x-start.x,y:target.y-start.y},requested=Math.hypot(delta.x,delta.y);
 // Translation has zero slope at the root and pinch. The free hook follows without twisting or collapsing.
 const candidate=k=>base.map((p,i)=>{const w=weight(i,rootIndex,g)*k;return {x:p.x+delta.x*w,y:p.y+delta.y*w};});
 const valid=curve=>prefixLength(curve,rootIndex,g)<=length*1.18+.00001&&smoothEnough(curve);
 let factor=Math.min(1,(length*.72+12)/Math.max(.0001,requested)),curve=candidate(factor);
 if(!valid(curve)){let lo=0,hi=factor;for(let i=0;i<22;i++){const mid=(lo+hi)/2;if(valid(candidate(mid)))lo=mid;else hi=mid;}factor=lo;curve=candidate(factor);}
 const pose={curve,rootIndex,gripT:grip.t,pinch:held?Math.max(0,strength):0,correction:{x:0,y:0},length,stretch:clamp(prefixLength(curve,rootIndex,g)/length-1,0,.18),saturated:factor<.999,phase:factor<.999?'resist':'bend'};
 const actual=mapped(grip,curve,pose.pinch,grip.t),goal={x:start.x+delta.x*factor,y:start.y+delta.y*factor};pose.correction={x:goal.x-actual.x,y:goal.y-actual.y};
 if(strength!==1){pose.curve=curve.map((p,i)=>lerp(AHOGE_REST[i],p,strength));pose.correction.x*=strength;pose.correction.y*=strength;}
 fitOutline(pose,grip,lerp(start,goal,strength));
 if(!validOutline(pose)&&attempt<14){const limited=solveAhoge(source,lerp(start,target,.72),{strength,held,base,binding,attempt:attempt+1});limited.saturated=true;limited.phase='resist';return limited;}
 return pose;
}
const basis=t=>CONTROL.map((_,k)=>spline(CONTROL.map((_,j)=>({x:j===k?1:0,y:0})),t).x);
const FIT=Array.from({length:65},(_,i)=>{const t=i/64;return {t,b:basis(t),edges:ahogeEdges(t)};});
const FREE_COUNT=CONTROL.length-3;
const NORMAL=Array.from({length:FREE_COUNT},(_,i)=>Array.from({length:FREE_COUNT},(_,j)=>FIT.reduce((n,r)=>n+r.b[i+2]*r.b[j+2],0)));
function linearSolve(matrix,values){
 const n=matrix.length,m=matrix.map((r,i)=>[...r,values[i]]);
 for(let k=0;k<n;k++){let pivot=k;for(let j=k+1;j<n;j++)if(Math.abs(m[j][k])>Math.abs(m[pivot][k]))pivot=j;[m[k],m[pivot]]=[m[pivot],m[k]];const d=m[k][k];for(let j=k;j<n+1;j++)m[k][j]/=d;for(let i=0;i<n;i++)if(i!==k){const q=m[i][k];for(let j=k;j<n+1;j++)m[i][j]-=q*m[k][j];}}
 return m.map(r=>r[n]);
}
const CHECK=Array.from({length:257},(_,i)=>{const t=i/256;return {b:basis(t),edges:ahogeEdges(t)};});
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function validOutline(pose){
 let prev=null;
 for(const row of CHECK){
  const current=pose.outline.map(edge=>row.b.reduce((p,b,i)=>({x:p.x+b*edge[i].x,y:p.y+b*edge[i].y}),{x:0,y:0}));
  if(prev){
   const a=cross(prev.original[0],prev.original[1],row.edges[0]),b=cross(prev.deformed[0],prev.deformed[1],current[0]);
   const c=cross(prev.original[1],row.edges[1],row.edges[0]),d=cross(prev.deformed[1],current[1],current[0]);
   if((Math.abs(a)>.001&&a*b<=0)||(Math.abs(c)>.001&&c*d<=0))return false;
  }prev={original:row.edges,deformed:current};
 }return true;
}
function fitOutline(pose,grip,goal){
 const outline=EDGES.map((edge,side)=>{
  const values=FIT.map(r=>deformAhoge(bindingAt(r.edges[side],r.t*(AHOGE_REST.length-1)),pose)),tip=values.at(-1);
  const coords=['x','y'].map(key=>linearSolve(NORMAL,Array.from({length:FREE_COUNT},(_,i)=>FIT.reduce((n,r,j)=>n+r.b[i+2]*(values[j][key]-r.b[0]*edge[0][key]-r.b[1]*edge[1][key]-r.b.at(-1)*tip[key]),0))));
  return edge.map((p,i)=>i<2?{...p}:i===edge.length-1?{...tip}:{x:coords[0][i-2],y:coords[1][i-2]});
 });
 pose.outline=outline;
 // Exact material pin while the first two controls keep the attachment and tangent fixed.
 if(Number.isFinite(grip.u)){
  const actual=deformAhoge(grip,pose),b=basis(grip.t/(AHOGE_REST.length-1)),den=b.slice(2).reduce((n,x)=>n+x*x,0);
  if(den>1e-5){for(const edge of outline)for(let i=2;i<edge.length;i++){const w=b[i]/den;edge[i].x+=(goal.x-actual.x)*w;edge[i].y+=(goal.y-actual.y)*w;}}
 }
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
