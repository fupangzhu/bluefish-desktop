const clamp=n=>Math.max(0,Math.min(1,n));
function openness(t){if(t<0||t>=.32)return 1;return t<.13?1-Math.sin(t/.13*Math.PI/2):Math.sin((t-.13)/.19*Math.PI/2);}
// Most closures are synchronous. Choose a subtle stagger once per event.
export class Eyelids{
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(){this.blinkAt=-Infinity;this.blinkLead='l';this.blinkLag=0;this.rubLead='l';this.rubLag=0;this.rubbing=false;this.history=[{time:-Infinity,cap:1}];}
 timing(min,max){
  if(this.random()<.8)return {lead:'l',lag:0};
  return {lead:this.random()<.5?'l':'r',lag:min+this.random()*(max-min)};
 }
 blink(time){const {lead,lag}=this.timing(.010,.025);this.blinkAt=time;this.blinkLead=lead;this.blinkLag=lag;}
 sample(time,{rub=0,eyeCap=1}={}){
  const rubbing=rub>.1;
  if(rubbing&&!this.rubbing){const {lead,lag}=this.timing(.025,.065);this.rubLead=lead;this.rubLag=lag;}
  this.rubbing=rubbing;
  const cap=Number.isFinite(eyeCap)?clamp(eyeCap):1,last=this.history.at(-1);
  if(last.time===time)last.cap=cap;else this.history.push({time,cap});
  while(this.history.length>2&&this.history[1].time<time-.6)this.history.shift();
  const delayed=at=>{
   for(let i=1;i<this.history.length;i++){const a=this.history[i-1],b=this.history[i];if(at<=b.time){if(!Number.isFinite(a.time))return a.cap;return a.cap+(b.cap-a.cap)*clamp((at-a.time)/(b.time-a.time));}}
   return cap;
  };
  const eye=side=>{
   const blink=openness(time-this.blinkAt-(side===this.blinkLead?0:this.blinkLag));
   // Reopening uses the current cap so leaving a rub never leaves one eye stuck.
   const close=rubbing&&side!==this.rubLead?Math.max(cap,delayed(time-this.rubLag)):cap;
   return Math.min(blink,close);
  };
  return {left:eye('l'),right:eye('r')};
 }
}
