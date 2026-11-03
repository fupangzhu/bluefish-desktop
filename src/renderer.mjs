import {AHOGE_REST,bindAhoge,deformAhoge,solveAhoge} from './ahoge.mjs';
// Source-coordinate layered 2.5D rig. PNGs stay in a fixed 2048 grid.
const VERT=`attribute vec2 pos;attribute vec2 uv;varying vec2 tex;void main(){tex=uv;gl_Position=vec4(pos,0.,1.);}`;
const FRAG=`precision mediump float;varying vec2 tex;uniform sampler2D image;uniform float opacity;uniform float eyeOpen;uniform vec4 crop;uniform vec4 eye;uniform float aa;
void main(){vec4 color=texture2D(image,tex);if(eyeOpen>=0.){vec2 p=(crop.xy+tex*crop.zw-eye.xy);float yy=-sin(eye.z)*p.x+cos(eye.z)*p.y;float top=eyeOpen>=.5?eye.w*(1.-2.*eyeOpen):0.;float bottom=eyeOpen>=.5?eye.w:eye.w*eyeOpen*2.;float e=max(.0007,aa);float mask=smoothstep(top-e,top+e,yy)*(1.-smoothstep(bottom-e,bottom+e,yy));color*=mask;}gl_FragColor=color*opacity;}`;
const rad=d=>d*Math.PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const DROOP_MAX=90;       // degrees of bend at the ahoge tip when fully drooped
const FALLBACK_TEX_SCALE=.5; // WebGL1 has no mipmaps for NPOT textures: pre-shrink layers instead
function cleanHairBacking(canvas,x,y){
  // The separated backing includes isolated ear-tip/trim remnants. Keep its
  // connected hair mass; otherwise those pixels float in place when an ear folds.
  const ctx=canvas.getContext('2d'),image=ctx.getImageData(0,0,canvas.width,canvas.height),d=image.data;
  const w=canvas.width,h=canvas.height,seen=new Uint8Array(w*h),queue=new Uint32Array(w*h);
  const seed=clamp(Math.floor(y),0,h-1)*w+clamp(Math.floor(x),0,w-1);let head=0,tail=0;
  if(!d[seed*4+3])return;
  queue[tail++]=seed;seen[seed]=1;
  const visit=i=>{if(!seen[i]&&d[i*4+3]>16){seen[i]=1;queue[tail++]=i;}};
  while(head<tail){const i=queue[head++],col=i%w;if(col)visit(i-1);if(col<w-1)visit(i+1);if(i>=w)visit(i-w);if(i<w*(h-1))visit(i+w);}
  // Keep the antialiased fringe beside the main component, but discard faint
  // connecting pixels that otherwise preserve unrelated segmentation debris.
  for(let i=0;i<seen.length;i++)if(!seen[i]){
    const x=i%w,y=Math.floor(i/w);let neighbor=false;
    for(let dy=-1;dy<=1&&!neighbor;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&seen[i+dy*w+dx]){neighbor=true;break;}
    if(!neighbor)d[i*4+3]=0;
  }
  ctx.putImageData(image,0,0);
}
export class Renderer{
  constructor(canvas,rig){
    this.canvas=canvas;this.rig=rig;this.solo=null;const opts={alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true};
    this.gl=canvas.getContext('webgl2',opts)||canvas.getContext('webgl',opts);
    if(!this.gl)throw Error('无法启用 WebGL，请开启硬件加速');
    this.webgl2=typeof WebGL2RenderingContext!=='undefined'&&this.gl instanceof WebGL2RenderingContext;
    const g=this.gl,compile=(type,source)=>{const s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
    this.program=g.createProgram();g.attachShader(this.program,compile(g.VERTEX_SHADER,VERT));g.attachShader(this.program,compile(g.FRAGMENT_SHADER,FRAG));g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(this.program));g.useProgram(this.program);
    this.buffer=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,this.buffer);
    for(const [name,offset] of [['pos',0],['uv',8]]){const loc=g.getAttribLocation(this.program,name);g.enableVertexAttribArray(loc);g.vertexAttribPointer(loc,2,g.FLOAT,false,16,offset);}
    this.uniform=Object.fromEntries(['opacity','eyeOpen','crop','eye','aa'].map(k=>[k,g.getUniformLocation(this.program,k)]));
    g.enable(g.BLEND);g.blendFunc(g.ONE,g.ONE_MINUS_SRC_ALPHA);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);this.layers=[];this.byName=new Map();this.stats={drawCalls:0,vertices:0,frameMs:0};
  }
  async init(){
    for(const meta of this.rig.layers){
      if(meta.empty)continue;
      const img=new Image();img.src=meta.file;await img.decode();
      const [x0,y0,x1,y1]=meta.box,width=x1-x0,height=y1-y0;
      const k=this.webgl2?1:FALLBACK_TEX_SCALE,tw=Math.max(1,Math.round(width*k)),th=Math.max(1,Math.round(height*k));
      const cropped=document.createElement('canvas');cropped.width=tw;cropped.height=th;const c2=cropped.getContext('2d');c2.imageSmoothingEnabled=true;c2.imageSmoothingQuality='high';c2.drawImage(img,x0,y0,width,height,0,0,tw,th);
      if(meta.name==='hair_back')cleanHairBacking(cropped,(meta.pivot[0]-x0)*k,(meta.pivot[1]-y0)*k);
      if(meta.name==='ahoge')cleanHairBacking(cropped,(1198-x0)*k,(255-y0)*k);
      this.addLayer(meta,cropped);
    }
    // Draw the reference's inward-facing > < eyelids in source coordinates, so
    // they use the same head projection, occlusion and scaling as the original eyes.
    for(const eye of this.rig.eyes){
      const meta=this.byName.get(`eye_${eye.side}_closed`),[x0,y0,x1,y1]=meta.box;
      const image=document.createElement('canvas');image.width=x1-x0;image.height=y1-y0;
      const ctx=image.getContext('2d'),dir=eye.side==='l'?1:-1;
      ctx.translate(eye.center[0]-x0,eye.center[1]-y0);ctx.rotate(eye.tilt);
      ctx.strokeStyle='#234c70';ctx.lineWidth=18;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(-dir*60,-70);ctx.lineTo(dir*62,0);ctx.lineTo(-dir*60,70);ctx.stroke();
      this.addLayer({...meta,name:`eye_${eye.side}_pain`},image);
    }
    return this;
  }
  addLayer(meta,image){
    const [x0,y0,x1,y1]=meta.box,width=x1-x0,height=y1-y0;
    const rgba=image.getContext('2d').getImageData(0,0,image.width,image.height).data;
    const alpha=new Uint8Array(image.width*image.height);for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
    const layer={...meta,texture:this.texture(image),points:[],data:null,alpha,texWidth:image.width,texHeight:image.height};
    const n=meta.name==='ahoge'?64:meta.name.startsWith('eye_')?6:22;
    const vertex=(i,j)=>{const x=x0+width*i/n,y=y0+height*j/n;layer.points.push([x,y,i/n,j/n,meta.name==='ahoge'?bindAhoge({x,y}):null]);};
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){vertex(i,j);vertex(i+1,j);vertex(i,j+1);vertex(i+1,j);vertex(i+1,j+1);vertex(i,j+1);}
    layer.data=new Float32Array(layer.points.length*4);layer.points.forEach((p,i)=>{layer.data[i*4+2]=p[2];layer.data[i*4+3]=p[3];});
    this.layers.push(layer);this.byName.set(layer.name,layer);
  }
  texture(image){
    const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);
    for(const [k,v] of [[g.TEXTURE_MAG_FILTER,g.LINEAR],[g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE],[g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE]])g.texParameteri(g.TEXTURE_2D,k,v);
    g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,image);
    if(this.webgl2){ // layers are shown 8x+ smaller than the art grid: mipmaps (premultiplied, so no fringes) remove the aliasing
      g.generateMipmap(g.TEXTURE_2D);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR_MIPMAP_LINEAR);
      const ext=this.aniso??(this.aniso=g.getExtension('EXT_texture_filter_anisotropic')||g.getExtension('WEBKIT_EXT_texture_filter_anisotropic')||null);
      if(ext)g.texParameterf(g.TEXTURE_2D,ext.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(4,g.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)||1));
    }else g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);
    return t;
  }  project(px,py,s,layer,raw=false,binding=null){
    const w=this.rig.size[0],h=this.rig.size[1],name=layer.name;
    if(name==='ahoge'&&this.ahogePose&&!raw){const p=deformAhoge(binding||bindAhoge({x:px,y:py}),this.ahogePose);px=p.x;py=p.y;}
    const lag=(s.hair??s.yaw)-s.yaw,t=s.time||0;let localAngle=0;
    let droop=0;
    if(name==='ahoge'){localAngle=lag*.32+(s.secondary?Math.sin(t*2.3)*1.2:0)+(s.ahogeWag||0);droop=clamp(s.ahogeDroop||0,0,1);}
    if(name.startsWith('bow_'))localAngle=lag*.19+(s.secondary?Math.sin(t*2.0+(name==='bow_l'?0:1.3))*.8:0);
    if(name.startsWith('ear_')){
      localAngle=lag*.07+(s.secondary?Math.sin(t*1.5)*.22:0);
      const fold=clamp((name==='ear_l'?s.earFoldL:s.earFoldR)||0,0,1),mood=clamp(s.earMood||0,-1,1);
      const bend=clamp(38*Math.max(0,-mood)-8*Math.max(0,mood)+65*fold,-8,75);
      if(bend){
        const dx=px-layer.pivot[0],dy=py-layer.pivot[1];
        // The inboard attachment stays fixed under the headdress and bow.
        const u=clamp((name==='ear_l'?-dx:dx)/((layer.box[2]-layer.box[0])*.55),0,1),weight=u*u*(3-2*u);
        const a=rad((name==='ear_l'?-1:1)*bend*weight);
        px=layer.pivot[0]+Math.cos(a)*dx-Math.sin(a)*dy;py=layer.pivot[1]+Math.sin(a)*dx+Math.cos(a)*dy;
      }
    }
    if(localAngle||droop){const dx=px-layer.pivot[0],dy=py-layer.pivot[1];let deg=localAngle;
      if(droop)deg+=droop*DROOP_MAX*clamp(Math.hypot(dx,dy)/(layer.box[3]-layer.box[1]),0,1)**1.3; // bend: grows toward the tip, positive = tip flops forward/down
      const a=rad(deg);px=layer.pivot[0]+Math.cos(a)*dx-Math.sin(a)*dy;py=layer.pivot[1]+Math.sin(a)*dx+Math.cos(a)*dy;}
    if(name.startsWith('eye_')){px+=(s.gx||0)*w*.006;py+=(s.gy||0)*h*.005;}
    let x=px/w-.5,y=py/h-.5;
    if(name==='hair_back'){const tip=Math.max(0,(py/h-.48)/.5);x+=lag*.0009*tip+(s.secondary?Math.sin(t*1.6+x*4)*.0025*tip:0);}
    if(name==='hair_front'){const tip=Math.max(0,(py/h-.42)/.5);x+=lag*.0002*tip;}
    const bulge=.075*Math.exp(-((x/.38)**2+((y-.1)/.4)**2));
    const z=layer.depth+bulge,yaw=rad(s.yaw),pitch=rad(s.pitch),roll=rad(s.roll);
    const xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw);
    const yy=y*Math.cos(pitch)-zz*Math.sin(pitch),rx=xx*Math.cos(roll)-yy*Math.sin(roll),ry=xx*Math.sin(roll)+yy*Math.cos(roll);
    return [rx*1.76,-(ry+(s.breath||0))*1.76];
  }
  draw(layer,s,opacity=1,eyeOpen=-1){
    if(!layer||opacity<=0)return;
    const g=this.gl,[w,h]=this.rig.size,[x0,y0,x1,y1]=layer.box;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    layer.points.forEach((p,i)=>{const [x,y]=this.project(p[0],p[1],s,layer,false,p[4]);layer.data[i*4]=x;layer.data[i*4+1]=y;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);});
    layer.bounds=[minX,minY,maxX,maxY];if(opacity>.1)this.drawn.push(layer);
    g.uniform1f(this.uniform.opacity,opacity);g.uniform1f(this.uniform.aa,1.5/(this.canvas.width*.88));g.uniform1f(this.uniform.eyeOpen,eyeOpen);g.uniform4f(this.uniform.crop,x0/w,y0/h,(x1-x0)/w,(y1-y0)/h);
    if(layer.eyeSide){const e=this.rig.eyes.find(e=>e.side===layer.eyeSide);g.uniform4f(this.uniform.eye,e.center[0]/w,e.center[1]/h,e.tilt,(e.box[3]-e.box[1])/h*.47);}
    g.bindTexture(g.TEXTURE_2D,layer.texture);g.bufferData(g.ARRAY_BUFFER,layer.data,g.DYNAMIC_DRAW);g.drawArrays(g.TRIANGLES,0,layer.data.length/4);this.stats.drawCalls++;this.stats.vertices+=layer.points.length;
  }
  render(s){
    const begin=performance.now(),g=this.gl,c=this.canvas,dpr=Math.min(devicePixelRatio||1,2),size=Math.round(c.clientWidth*dpr);
    if(c.width!==size||c.height!==size)c.width=c.height=size;
    this.ahogePose=null;
    if(s.ahogeGrab){
      const grab=s.ahogeGrab,rect=c.getBoundingClientRect(),layer=this.byName.get('ahoge');
      const aim={x:(grab.client.x-rect.left)/rect.width*2-1,y:1-(grab.client.y-rect.top)/rect.height*2};
      // Invert the current head projection, so looking around never slides the
      // pinched material point out from under the cursor.
      let x=grab.source.x,y=grab.source.y;
      for(let i=0;i<6;i++){
        const p=this.project(x,y,s,layer,true),dx=this.project(x+1,y,s,layer,true),dy=this.project(x,y+1,s,layer,true);
        const ax=dx[0]-p[0],ay=dx[1]-p[1],bx=dy[0]-p[0],by=dy[1]-p[1],det=ax*by-ay*bx;
        if(Math.abs(det)<1e-12)break;
        const ex=aim.x-p[0],ey=aim.y-p[1];x+=clamp((ex*by-ey*bx)/det,-4096,4096);y+=clamp((ey*ax-ex*ay)/det,-4096,4096);
      }
      this.ahogePose=solveAhoge(grab.source,{x,y},{strength:grab.strength,held:grab.held,base:grab.base||AHOGE_REST});
    }
    g.viewport(0,0,c.width,c.height);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);this.stats.drawCalls=0;this.stats.vertices=0;this.drawn=[];
    if(this.solo){const layer=this.byName.get(this.solo);if(layer)this.draw(layer,s);}
    else for(const name of this.rig.drawOrder){
      const layer=this.byName.get(name);if(!layer)continue;
      if(name.startsWith('eye_')&&name.endsWith('_open')){
        const openness=layer.eyeSide==='l'?s.left:s.right,pain=(s.pain||0)>.08?1:0;
        if(openness>.015)this.draw(layer,s,1-pain,openness);
        if(openness<.15)this.draw(this.byName.get(name.replace('_open','_closed')),s,(1-openness/.15)*(1-pain));
        if(pain)this.draw(this.byName.get(name.replace('_open','_pain')),s,pain);
      }else this.draw(layer,s);
    }
    this.stats.frameMs=performance.now()-begin;
  }
  hitTest(x,y){const g=this.gl,p=new Uint8Array(4);if(x<0||y<0||x>=this.canvas.clientWidth||y>=this.canvas.clientHeight)return false;const scale=this.canvas.width/this.canvas.clientWidth;g.readPixels(Math.floor(x*scale),this.canvas.height-1-Math.floor(y*scale),1,1,g.RGBA,g.UNSIGNED_BYTE,p);return p[3]>24;}
  pickPart(x,y){return this.pickHit(x,y)?.part||null;}
  pickHit(x,y){
    if(x<0||y<0||x>=this.canvas.clientWidth||y>=this.canvas.clientHeight)return null;
    x=x/this.canvas.clientWidth*2-1;y=1-y/this.canvas.clientHeight*2;
    // Invert the triangles actually rendered, then sample texture alpha. Hidden
    // portions of ears and empty space inside the ahoge loop cannot intercept clicks.
    for(const layer of [...(this.drawn||[])].reverse()){
      const [minX,minY,maxX,maxY]=layer.bounds;if(x<minX||x>maxX||y<minY||y>maxY)continue;
      const d=layer.data;
      for(let i=0;i<d.length;i+=12){
        const ax=d[i],ay=d[i+1],bx=d[i+4],by=d[i+5],cx=d[i+8],cy=d[i+9];
        const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-12)continue;
        const a=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den,b=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den,c=1-a-b;
        if(a<-.00001||b<-.00001||c<-.00001)continue;
        const u=a*d[i+2]+b*d[i+6]+c*d[i+10],v=a*d[i+3]+b*d[i+7]+c*d[i+11];
        const tx=clamp(Math.floor(u*layer.texWidth),0,layer.texWidth-1),ty=clamp(Math.floor(v*layer.texHeight),0,layer.texHeight-1);
        if(layer.alpha[ty*layer.texWidth+tx]>24){
          if(!['ahoge','ear_l','ear_r'].includes(layer.name))return null;
          const [x0,y0,x1,y1]=layer.box;
          return {part:layer.name,source:{x:x0+u*(x1-x0),y:y0+v*(y1-y0)},curve:layer.name==='ahoge'&&this.ahogePose?AHOGE_REST.map(p=>deformAhoge(bindAhoge(p),this.ahogePose)):null};
        }
      }
    }
    return null;
  }
}
