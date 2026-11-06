const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const rad=n=>n*Math.PI/180;
export function flick(t,ear){
 if(!ear||t<0||t>=ear.count*ear.period)return 0;
 const cycle=Math.floor(t/ear.period),u=t/ear.period-cycle;
 const wave=Math.sin(u*Math.PI*2)*Math.sin(u*Math.PI);
 return wave*(wave<0?.42:1)*ear.amplitude*(cycle?.78:1);
}
export function deformEar(x,y,layer,s){
 const side=layer.name==='ear_l'?-1:1,root=layer.pivot,dx=x-root[0],dy=y-root[1];
 const u=clamp(side*dx/((layer.box[2]-layer.box[0])*.55),0,1),weight=u*u*(3-2*u);
 const sleep=clamp((side<0?s.earSleepL:s.earSleepR)??s.sleep??0,0,1),mood=clamp((side<0?s.earMoodL:s.earMoodR)??s.earMood??0,-1,1),ear=side<0?s.earTwitchL:s.earTwitchR;
 const legacy=clamp((side<0?s.earFoldL:s.earFoldR)||0,0,1),press=clamp((side<0?s.earPressL:s.earPressR)||0,0,1);
 let base=38*Math.max(0,-mood)-8*Math.max(0,mood)+16*sleep;
 if(!base&&!ear&&!legacy&&!press)return [x,y];
 let a=rad(side*base*weight);
 let px=Math.cos(a)*dx-Math.sin(a)*dy,py=Math.sin(a)*dx+Math.cos(a)*dy+sleep*(layer.box[2]-layer.box[0])*.035*weight;
 const rootWave=ear?flick(ear.elapsed,ear):legacy;
 const tipWave=ear?flick(ear.elapsed-u*.035,ear):legacy;
 // The initial impulse is small at the base; the flexible distal section follows later.
 a=rad(-side*(5*rootWave*Math.min(1,u*4)+13*tipWave*u**1.35));
 let xx=Math.cos(a)*px-Math.sin(a)*py,yy=Math.sin(a)*px+Math.cos(a)*py;
 const axisX=side,axisY=-.35,len=Math.hypot(axisX,axisY),ex=axisX/len,ey=axisY/len;
 const along=(xx*ex+yy*ey)*(1-.04*u*Math.max(0,tipWave)),cross=-xx*ey+yy*ex;
 const twist=rad(26*tipWave*u),bend=-side*(layer.box[2]-layer.box[0])*.055*tipWave*u*u;
 const narrow=cross*Math.cos(twist)+bend;
 let fx=along*ex-narrow*ey,fy=along*ey+narrow*ex;
 if(press){
  // Leaning on a wall: the outer ear is pushed up against the head and squashed flat.
  // Rotate inward about the root, compress its outward reach, and let it spread a little along the wall.
  const k=press*weight,r=rad(-side*24*k),rx=Math.cos(r)*fx-Math.sin(r)*fy,ry=Math.sin(r)*fx+Math.cos(r)*fy;
  fx=rx*(1-.42*k);fy=ry*(1+.12*k)-(layer.box[3]-layer.box[1])*.04*k;
 }
 return [root[0]+fx,root[1]+fy];
}
