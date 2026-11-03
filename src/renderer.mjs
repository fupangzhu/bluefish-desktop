// Source-coordinate layered 2.5D rig. PNGs stay in a fixed 2048 grid.
const VERT=`attribute vec2 pos;attribute vec2 uv;varying vec2 tex;void main(){tex=uv;gl_Position=vec4(pos,0.,1.);}`;
const FRAG=`precision mediump float;varying vec2 tex;uniform sampler2D image;uniform float opacity;uniform float eyeOpen;uniform vec4 crop;uniform vec4 eye;
void main(){vec4 color=texture2D(image,tex);if(eyeOpen>=0.){vec2 p=(crop.xy+tex*crop.zw-eye.xy);float yy=-sin(eye.z)*p.x+cos(eye.z)*p.y;float top=eyeOpen>=.5?eye.w*(1.-2.*eyeOpen):0.;float bottom=eyeOpen>=.5?eye.w:eye.w*eyeOpen*2.;float mask=smoothstep(top-.0007,top+.0007,yy)*(1.-smoothstep(bottom-.0007,bottom+.0007,yy));color*=mask;}gl_FragColor=color*opacity;}`;
const rad=d=>d*Math.PI/180;
export class Renderer{
  constructor(canvas,rig){
    this.canvas=canvas;this.rig=rig;this.solo=null;this.gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true});
    if(!this.gl)throw Error('无法启用 WebGL，请开启硬件加速');
    const g=this.gl,compile=(type,source)=>{const s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
    this.program=g.createProgram();g.attachShader(this.program,compile(g.VERTEX_SHADER,VERT));g.attachShader(this.program,compile(g.FRAGMENT_SHADER,FRAG));g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(this.program));g.useProgram(this.program);
    this.buffer=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,this.buffer);
    for(const [name,offset] of [['pos',0],['uv',8]]){const loc=g.getAttribLocation(this.program,name);g.enableVertexAttribArray(loc);g.vertexAttribPointer(loc,2,g.FLOAT,false,16,offset);}
    this.uniform=Object.fromEntries(['opacity','eyeOpen','crop','eye'].map(k=>[k,g.getUniformLocation(this.program,k)]));
    g.enable(g.BLEND);g.blendFunc(g.ONE,g.ONE_MINUS_SRC_ALPHA);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);this.layers=[];this.byName=new Map();this.stats={drawCalls:0,vertices:0,frameMs:0};
  }
  async init(){
    for(const meta of this.rig.layers){
      if(meta.empty)continue;
      const img=new Image();img.src=meta.file;await img.decode();
      const [x0,y0,x1,y1]=meta.box,width=x1-x0,height=y1-y0;
      const cropped=document.createElement('canvas');cropped.width=width;cropped.height=height;cropped.getContext('2d').drawImage(img,x0,y0,width,height,0,0,width,height);
      const layer={...meta,texture:this.texture(cropped),points:[],data:null};
      const n=meta.name.startsWith('eye_')?6:22;
      const vertex=(i,j)=>layer.points.push([x0+width*i/n,y0+height*j/n,i/n,j/n]);
      for(let j=0;j<n;j++)for(let i=0;i<n;i++){vertex(i,j);vertex(i+1,j);vertex(i,j+1);vertex(i+1,j);vertex(i+1,j+1);vertex(i,j+1);}
      layer.data=new Float32Array(layer.points.length*4);layer.points.forEach((p,i)=>{layer.data[i*4+2]=p[2];layer.data[i*4+3]=p[3];});
      this.layers.push(layer);this.byName.set(layer.name,layer);
    }
    return this;
  }
  texture(image){const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);for(const [k,v] of [[g.TEXTURE_MIN_FILTER,g.LINEAR],[g.TEXTURE_MAG_FILTER,g.LINEAR],[g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE],[g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE]])g.texParameteri(g.TEXTURE_2D,k,v);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,image);return t;}
  project(px,py,s,layer){
    const w=this.rig.size[0],h=this.rig.size[1],name=layer.name;
    const lag=(s.hair??s.yaw)-s.yaw,t=s.time||0;let localAngle=0;
    if(name==='ahoge')localAngle=lag*.32+(s.secondary?Math.sin(t*2.3)*1.2:0);
    if(name.startsWith('bow_'))localAngle=lag*.19+(s.secondary?Math.sin(t*2.0+(name==='bow_l'?0:1.3))*.8:0);
    if(name.startsWith('ear_'))localAngle=lag*.07+(s.secondary?Math.sin(t*1.5)*.22:0);
    if(localAngle){const a=rad(localAngle),dx=px-layer.pivot[0],dy=py-layer.pivot[1];px=layer.pivot[0]+Math.cos(a)*dx-Math.sin(a)*dy;py=layer.pivot[1]+Math.sin(a)*dx+Math.cos(a)*dy;}
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
    const g=this.gl,[w,h]=this.rig.size,[x0,y0,x1,y1]=layer.box;
    layer.points.forEach((p,i)=>{const [x,y]=this.project(p[0],p[1],s,layer);layer.data[i*4]=x;layer.data[i*4+1]=y;});
    g.uniform1f(this.uniform.opacity,opacity);g.uniform1f(this.uniform.eyeOpen,eyeOpen);g.uniform4f(this.uniform.crop,x0/w,y0/h,(x1-x0)/w,(y1-y0)/h);
    if(layer.eyeSide){const e=this.rig.eyes.find(e=>e.side===layer.eyeSide);g.uniform4f(this.uniform.eye,e.center[0]/w,e.center[1]/h,e.tilt,(e.box[3]-e.box[1])/h*.47);}
    g.bindTexture(g.TEXTURE_2D,layer.texture);g.bufferData(g.ARRAY_BUFFER,layer.data,g.DYNAMIC_DRAW);g.drawArrays(g.TRIANGLES,0,layer.data.length/4);this.stats.drawCalls++;this.stats.vertices+=layer.points.length;
  }
  render(s){
    const begin=performance.now(),g=this.gl,c=this.canvas,dpr=Math.min(devicePixelRatio||1,2),size=Math.round(c.clientWidth*dpr);
    if(c.width!==size||c.height!==size)c.width=c.height=size;
    g.viewport(0,0,c.width,c.height);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);this.stats.drawCalls=0;this.stats.vertices=0;
    if(this.solo){const layer=this.byName.get(this.solo);if(layer)this.draw(layer,s);}
    else for(const name of this.rig.drawOrder){const layer=this.byName.get(name);if(!layer)continue;if(name.startsWith('eye_')&&name.endsWith('_open')){const openness=layer.eyeSide==='l'?s.left:s.right;if(openness>.015)this.draw(layer,s,1,openness);if(openness<.15){const lid=this.byName.get(name.replace('_open','_closed'));this.draw(lid,s,1-openness/.15);}}else this.draw(layer,s);}
    this.stats.frameMs=performance.now()-begin;
  }
  hitTest(x,y){const g=this.gl,p=new Uint8Array(4);if(x<0||y<0||x>=this.canvas.clientWidth||y>=this.canvas.clientHeight)return false;const scale=this.canvas.width/this.canvas.clientWidth;g.readPixels(Math.floor(x*scale),this.canvas.height-1-Math.floor(y*scale),1,1,g.RGBA,g.UNSIGNED_BYTE,p);return p[3]>24;}
}
