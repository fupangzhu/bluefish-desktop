// Window coordinates and size are device-independent pixels throughout.
// opts.lockY: horizontal-only drag (docked mode).
function createDrag(point,bounds,opts={}){return {point:{...point},bounds:{...bounds},active:false,lockY:!!opts.lockY};}
// size is the computed {width,height}; never derive it from the native bounds.
function dragBounds(drag,point,current,size){
  const dx=point.x-drag.point.x,dy=point.y-drag.point.y;
  if(!drag.active&&Math.hypot(dx,dy)<5)return null;
  drag.active=true;
  const next={x:Math.round(drag.bounds.x+dx),y:Math.round(drag.bounds.y+(drag.lockY?0:dy)),width:size.width,height:size.height};
  // Fractional display scaling can round the native height by one DIP. Do not
  // repeatedly reposition a stationary window to chase that non-accumulating bit.
  if(next.x===current.x&&next.y===current.y&&Math.abs(next.width-current.width)<=1&&Math.abs(next.height-current.height)<=1)return null;
  return next;
}
module.exports={createDrag,dragBounds};
