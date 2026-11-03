const MIN_SIZE=80,MAX_SIZE=640,DEFAULT_SIZE=200;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
function normalizeSize(value,fallback=DEFAULT_SIZE){const n=Number(value);return Number.isFinite(n)?clamp(Math.round(n),MIN_SIZE,MAX_SIZE):fallback;}
function dimensions(size,docked){size=normalizeSize(size);const edge=Math.round(size*.64),overlap=Math.min(6,Math.ceil(size*.03));return {width:size,height:docked?edge+overlap:size,edge:docked?edge:size,overlap:docked?overlap:0};}
function place(work,size,docked,x,y){const d=dimensions(size,docked),left=Number.isFinite(x)?x:work.x+work.width-d.width-20,top=!docked&&Number.isFinite(y)?clamp(y,work.y,Math.max(work.y,work.y+work.height-d.height)):work.y+work.height-d.edge;return {...d,x:Math.round(clamp(left,work.x,Math.max(work.x,work.x+work.width-d.width))),y:Math.round(top)};}
function loadSettings(saved){const fresh=saved?.version!==3;return {version:3,size:fresh?DEFAULT_SIZE:normalizeSize(saved.size),docked:fresh?true:saved.docked!==false,x:!fresh&&Number.isFinite(saved.x)?saved.x:null,y:!fresh&&Number.isFinite(saved.y)?saved.y:null,displayId:!fresh?saved.displayId:null};}
module.exports={MIN_SIZE,MAX_SIZE,DEFAULT_SIZE,normalizeSize,dimensions,place,loadSettings};
