// Pure window-geometry helpers. All values are device-independent pixels.
const MIN_SIZE=150,MAX_SIZE=460,DEFAULT_SIZE=240;
function clampSize(n){
  if(typeof n!=='number'||!Number.isFinite(n))return DEFAULT_SIZE;
  return Math.min(MAX_SIZE,Math.max(MIN_SIZE,Math.round(n)));
}
function layout(size,docked){
  const s=clampSize(size);
  if(!docked)return {width:s,height:s,grip:0};
  const grip=Math.round(s*0.05);
  return {width:Math.round(s*1.3),height:Math.round(s*0.70)+grip,grip};
}
const clamp=(v,lo,hi)=>hi<lo?lo:Math.min(hi,Math.max(lo,v));
// Docked: bottom edge sits `grip` px below the work-area bottom (overlaps the taskbar top).
function dockedBounds(workArea,displayBounds,size,centerX){
  const {width,height,grip}=layout(size,true);
  const x=clamp(Math.round(centerX-width/2),displayBounds.x,displayBounds.x+displayBounds.width-width);
  return {x,y:workArea.y+workArea.height+grip-height,width,height};
}
function freeBounds(workArea,size,center){
  const {width,height}=layout(size,false);
  return {
    x:clamp(Math.round(center.x-width/2),workArea.x,workArea.x+workArea.width-width),
    y:clamp(Math.round(center.y-height/2),workArea.y,workArea.y+workArea.height-height),
    width,height
  };
}
const homeCenterX=workArea=>workArea.x+workArea.width*0.2;
// dy: cursor y delta since the drag started (negative = up).
const shouldUndock=(dy,size)=>dy<-Math.max(60,clampSize(size)*0.35);
const shouldDock=(bounds,workArea)=>bounds.y+bounds.height-(workArea.y+workArea.height)>-24;
// Popup placement: open down/right of the point, flip up/left when it would overflow, then clamp.
function popupPosition(point,size,workArea){
  const right=workArea.x+workArea.width,bottom=workArea.y+workArea.height;
  let x=point.x+size.width>right?point.x-size.width:point.x;
  let y=point.y+size.height>bottom?point.y-size.height:point.y;
  x=clamp(Math.round(x),workArea.x,right-size.width);
  y=clamp(Math.round(y),workArea.y,bottom-size.height);
  return {x,y,width:size.width,height:size.height};
}
module.exports={MIN_SIZE,MAX_SIZE,DEFAULT_SIZE,clampSize,layout,dockedBounds,freeBounds,homeCenterX,shouldUndock,shouldDock,popupPosition};
