// Capture real application frames for the GitHub README. No production settings are changed.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');const {pathToFileURL}=require('node:url');
const REPO=path.resolve(__dirname,'../..'),OUT=path.join(__dirname,'.work/readme-v2');fs.mkdirSync(OUT,{recursive:true});app.setPath('userData',path.join(OUT,'profile'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let server,base;const manifest=fs.existsSync(path.join(OUT,'manifest.json'))?JSON.parse(fs.readFileSync(path.join(OUT,'manifest.json'),'utf8')):{clips:{},stills:{}};
app.commandLine.appendSwitch('force-device-scale-factor','1.5');app.on('window-all-closed',()=>{});
const preload=path.join(OUT,'preload.cjs');
fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');const state={size:240,docked:true,follow:true,idle:false,reduced:false,pose:{yaw:0,pitch:0,roll:0}};contextBridge.exposeInMainWorld('pet',{onState:cb=>ipcRenderer.on('state',(_e,p)=>cb(p)),onPointer:()=>{},onAction:()=>{},setInteractive:()=>{},drag:()=>{},menu:()=>{},zoom:()=>{}});contextBridge.exposeInMainWorld('petControl',{getState:async()=>state,onState:()=>{},set:()=>{},action:()=>{},command:()=>{},fit:()=>{}});`);
function windowFor(width,height){return new BrowserWindow({width,height,useContentSize:true,show:false,frame:false,transparent:true,backgroundColor:'#00000000',webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});}
async function ready(wc,expr){for(let i=0;i<160;i++){try{if(await wc.executeJavaScript(expr))return;}catch{}await sleep(75);}throw Error('Renderer did not become ready');}
async function overlay(width=420,height=420,size=400,docked=false){
 const win=windowFor(width,height),wc=win.webContents;await win.loadURL(base+'/overlay.html');await ready(wc,'!!window.bluefish?.renderer');
 wc.send('state',{size,docked,follow:true,idle:false,reduced:false,pose:{yaw:0,pitch:0,roll:0}});await sleep(120);
 await wc.executeJavaScript('bluefish.motion.reset();bluefish.motion.nextBlink=Infinity');return win;
}
async function shot(wc,name){const file=path.join(OUT,name);fs.mkdirSync(path.dirname(file),{recursive:true});const image=await wc.capturePage();fs.writeFileSync(file,image.toPNG());return image.getSize();}
async function pointer(wc,expression){await wc.executeJavaScript(expression);}
async function hero(){
 const win=await overlay(800,360,320,true),wc=win.webContents,frames=[];let phase='right',rest=0;
 for(let i=0;i<160;i++){
  const start=Date.now(),state=await wc.executeJavaScript('({offset:bluefish.peek.offset,stepping:!!bluefish.peek.step})');
  if(phase==='right'&&state.offset>.115&&!state.stepping)phase='left';
  if(phase==='left'&&state.offset<.001&&!state.stepping)phase='rest';
  const x=phase==='right'?680+Math.sin(i*.35)*8:phase==='left'?140+Math.sin(i*.35)*8:400,y=phase==='rest'?24:205;
  await pointer(wc,`(()=>{const b=bluefish,p=b.position(),s=b.state.size;b.setPointer({x:${x},y:${y},gx:${phase==='rest'?0:phase==='right'?1:-1},gy:0});})()`);
  await sleep(Math.max(0,80-(Date.now()-start)));const file='hero/'+String(i).padStart(3,'0')+'.png';await shot(wc,file);frames.push({file,x,y,duration:80});
  if(phase==='rest'&&++rest>=18)break;
 }
 manifest.clips.hero={width:800,height:360,ledge:344,frames};win.destroy();console.log('Captured hero: '+frames.length+' frames');
}
async function petting(reaction){
 const win=await overlay(),wc=win.webContents,frames=[];await wc.executeJavaScript(`bluefish.motion.attention.pickReaction=()=> '${reaction}';bluefish.motion.attention.random=()=>0;true;`);
 for(let i=0;i<100;i++){
  const start=Date.now(),t=i*.09;
  if(t<4.2)await pointer(wc,`(()=>{const b=bluefish,p=b.position(),s=b.state.size,x=Math.sin(${t}*5);b.setPointer({x:p.left+s*(.5+x*.12),y:p.top+s*.44,gx:x*.5,gy:0});})()`);
  else await pointer(wc,'bluefish.setPointer(null);bluefish.motion.setGaze(0,0)');
  await sleep(Math.max(0,90-(Date.now()-start)));const file='petting-'+reaction+'/'+String(i).padStart(3,'0')+'.png';await shot(wc,file);frames.push({file,duration:90});
 }
 manifest.clips[reaction]={width:420,height:420,frames};win.destroy();console.log('Captured petting: '+reaction);
}
async function interaction(){
 const win=await overlay(800,360,320,true),wc=win.webContents,frames=[];
 await wc.executeJavaScript("bluefish.motion.attention.pickReaction=()=> 'playful';bluefish.motion.wake.random=()=>.6;true");
 for(let i=0;i<210;i++){
  const start=Date.now(),t=i*.08;let point;
  if(i===60)await wc.executeJavaScript('bluefish.setPointer(null);bluefish.forceSulk();bluefish.motion.attention.droop=1;bluefish.motion.attention.lastNear=-30;bluefish.motion.attention.lastMove=-30;bluefish.motion.attention.lastInteraction=bluefish.motion.attention.idleTime-601');
  if(t<.4||t>=14.7)point=await wc.executeJavaScript('(()=>{bluefish.setPointer(null);bluefish.motion.setGaze(0,0);return {x:680,y:90};})()');
  else if(t<3.7)point=await wc.executeJavaScript(`(()=>{const b=bluefish,p=b.position(),s=b.state.size,x=p.left+s*(.5+Math.sin(${t}*5)*.12),y=p.top+s*.44;b.setPointer({x,y,gx:0,gy:0});return {x,y};})()`);
  else if(t<9.2)point=await wc.executeJavaScript('(()=>{bluefish.setPointer(null);bluefish.motion.setGaze(0,0);return {x:680,y:90};})()');
  else point=await wc.executeJavaScript(`(()=>{const b=bluefish,p=b.position(),s=b.state.size,x=p.left+s*.5,y=p.top+s*.35;b.setPointer({x,y,gx:0,gy:0});return {x,y};})()`);
  if(i===126){const x=Math.round(point.x),y=Math.round(point.y);wc.sendInputEvent({type:'mouseMove',x,y});wc.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});}
  await sleep(Math.max(0,80-(Date.now()-start)));const file='interaction/'+String(i).padStart(3,'0')+'.png';await shot(wc,file);frames.push({file,...point,click:i>=126&&i<133?(i-126)/7:null,duration:80});
 }
 manifest.clips.interaction={width:800,height:360,ledge:344,frames};win.destroy();console.log('Captured continuous interaction: '+frames.length+' frames');
}
async function stills(){
 const win=await overlay(420,420,400,true),wc=win.webContents;
 await wc.executeJavaScript('bluefish.setPointer(null);bluefish.forceSulk();bluefish.motion.attention.lastNear=-30;bluefish.motion.attention.lastMove=-30;bluefish.motion.attention.droop=1');await sleep(1200);
 await shot(wc,'sleep-droop.png');manifest.stills.droop={file:'sleep-droop.png',width:420,height:420,ledge:400};
 await wc.executeJavaScript('bluefish.motion.attention.random=()=>1;bluefish.motion.attention.lastInteraction=bluefish.motion.attention.idleTime-601');await sleep(4500);
 await shot(wc,'sleep-asleep.png');manifest.stills.sleep={file:'sleep-asleep.png',width:420,height:420,ledge:400};win.destroy();
 for(const size of [150,240,460]){
  const width=Math.round(size*1.3),grip=Math.round(size*.05),height=Math.round(size*.7)+grip,w=await overlay(width,height,size,true);await sleep(350);
  const file='size-'+size+'.png';await shot(w.webContents,file);manifest.stills['size'+size]={file,width,height,ledge:height-grip};w.destroy();
 }
 const mw=windowFor(280,420);await mw.loadURL(base+'/menu.html');await sleep(900);await shot(mw.webContents,'menu.png');manifest.stills.menu={file:'menu.png',width:280,height:420};mw.destroy();
 const cw=windowFor(980,720);await cw.loadURL(base+'/');await ready(cw.webContents,'!!window.bluefish?.renderer');await sleep(1100);await shot(cw.webContents,'console.png');manifest.stills.console={file:'console.png',width:980,height:720};cw.destroy();console.log('Captured sleep, sizes, menu and console');
}
app.whenReady().then(async()=>{try{
 const {createServer}=await import(pathToFileURL(path.join(REPO,'server.mjs')));server=createServer({editor:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const only=process.argv.find(a=>a.startsWith('--only='))?.split('=')[1];
 if(!only){await hero();for(const reaction of ['sleepy','playful','subtle'])await petting(reaction);await stills();}
 await interaction();
 fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2));console.log('Capture complete: '+OUT);
}catch(e){console.error(e);process.exitCode=1;}finally{server?.close();app.exit(process.exitCode||0);}});
