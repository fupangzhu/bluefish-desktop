// The "hands" are two soft mochi-like flattened balls resting across the taskbar edge. Pure canvas 2D.
export const HAND_WIDTH=0.13;            // ball width as a fraction of the avatar size
export const HAND_HEIGHT=0.075;          // ball height as a fraction of the avatar size
export const BELOW_LEDGE=0.4;            // share of the ball height that hangs below the ledge line
export const FALLBACK_SKIN=[253,238,232];  // #fdeee8
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
const css=(c,a=1)=>`rgba(${c[0]},${c[1]},${c[2]},${a})`;
// Derive the fill tone from one sampled colour (top/edge kept for API compatibility).
export function makeSkin(rgb=FALLBACK_SKIN){
  const base=rgb.map(v=>clamp(Math.round(v),0,255));
  return {base,top:mix(base,[255,255,255],.3),edge:[Math.round(base[0]*.955),Math.round(base[1]*.88),Math.round(base[2]*.87)]};
}
// Average a small block of the face layer around the cheek (art coordinates on the 2048 grid).
export async function sampleSkin(url='assets/layers/face.png',at=[900,1500],radius=5){
  try{
    const img=new Image();img.src=url;await img.decode();
    const c=document.createElement('canvas');c.width=c.height=radius*2+1;const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(img,at[0]-radius,at[1]-radius,c.width,c.height,0,0,c.width,c.height);
    const d=g.getImageData(0,0,c.width,c.height).data;let r=0,gg=0,b=0,n=0;
    for(let i=0;i<d.length;i+=4){if(d[i+3]>200){r+=d[i];gg+=d[i+1];b+=d[i+2];n++;}}
    return n<5?makeSkin():makeSkin([r/n,gg/n,b/n]);
  }catch{return makeSkin();}
}
// Each ball has its own personality so the pair does not look stamped: the left one is a little narrower and rounder,
// the right one a little wider/flatter and tilted (inner side lower). dy is the rest offset in units of s/240 px.
const SHAPES={'-1':{wk:.94,hk:1.07,tilt:0,dy:.6},'1':{wk:1.04,hk:.95,tilt:-5*Math.PI/180,dy:-.4},'0':{wk:1,hk:1,tilt:0,dy:0}};
const SQUEEZE=.03,TAP_LIFT=2,TAP_SQUASH=.1;
// Draws one ball. (x, y) is the contact point on the ledge line (y = ledgeY), w = base width in px.
// lift: px the ball is raised (it gets rounder), squash: 0..~0.3 landing flatten (wider, flatter).
// side: -1 left / 1 right ball. tap (0..1 lift envelope), tapSquash (0..1 landing), squeeze (-1..1): idle micro-motion from Peek.
// `rot`, `reach` are accepted for API compatibility and unused.
export function drawHand(ctx,{x,y,w,lift=0,squash=0,skin=makeSkin(),side=0,tap=0,tapSquash=0,squeeze=0,contact=0}){
  const U=w/HAND_WIDTH/240,shape=SHAPES[Math.sign(side)]||SHAPES[0];
  const bw=w*shape.wk,h0=w*HAND_HEIGHT/HAND_WIDTH*shape.hk;
  lift+=tap*TAP_LIFT*U;squash+=tapSquash*TAP_SQUASH;
  const rise=clamp(lift/(h0*1.2),0,1);
  const sw=bw*(1-.08*rise),sh=h0*(1+.28*rise);         // rounder while lifted
  const bottom=y+shape.dy*U+h0*BELOW_LEDGE-lift;       // keep the bottom edge anchored while squashing
  ctx.save();
  ctx.translate(x,bottom);ctx.scale((1+squash*.6)*(1+SQUEEZE*squeeze),(1-squash)*(1-SQUEEZE*squeeze));
  ctx.translate(0,-sh/2);ctx.rotate(shape.tilt);
  ctx.beginPath();ctx.ellipse(0,0,sw/2,sh/2,0,0,Math.PI*2);
  ctx.fillStyle=css(skin.base);
  if(contact>0){ctx.shadowColor=css(skin.edge,.25*contact);ctx.shadowBlur=w*.08;ctx.shadowOffsetY=w*.025;}
  ctx.fill();
  if(contact>0){ctx.shadowColor='transparent';ctx.strokeStyle=css(skin.edge,.65*contact);ctx.lineWidth=Math.max(.5,w*.018);ctx.stroke();}
  ctx.restore();
}
// Draws both balls. cx = window centre x, ledgeY, s = avatar size, hands = peek output.
export function drawHands(ctx,{cx,ledgeY,s,hands,skin}){
  const w=HAND_WIDTH*s;
  [-1,1].forEach((side,i)=>{const h=hands[i]||{};drawHand(ctx,{x:cx+side*.21*s+(h.x||0),y:ledgeY,w,lift:h.lift||0,squash:h.squash||0,skin,side,tap:h.tap||0,tapSquash:h.tapSquash||0,squeeze:h.squeeze||0,contact:h.contact||0});});
}
// Lift the existing round hands toward projected eyes; no new bitmap is needed.
export function eyeRubHands(hands,{eyes,cx,ledgeY,size,mix,phase=0}){
  return [-1,1].map((side,i)=>{
    const h=hands[i]||{},eye=eyes[i],jiggleX=Math.sin(phase+i*.5)*size*.006,jiggleY=Math.cos(phase+i*.5)*size*.004;
    return {...h,x:(h.x||0)*(1-mix)+(eye.x+jiggleX-(cx+side*.21*size))*mix,
      lift:(h.lift||0)*(1-mix)+(ledgeY-eye.y-jiggleY)*mix,tap:0,tapSquash:0,squeeze:0,contact:mix};
  });
}
