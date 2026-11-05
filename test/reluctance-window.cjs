const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),dock=require('../desktop/dock.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'.test-output/reluctance');fs.mkdirSync(OUT,{recursive:true});app.setPath('userData',path.join(OUT,'profile'));
const preload=path.join(OUT,'preload.cjs');fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('pet',{onState:cb=>ipcRenderer.on('state',(_e,p)=>cb(p)),onPointer:()=>{},onAction:()=>{},setInteractive:()=>{},drag:()=>{},menu:()=>{},zoom:()=>{}});`);
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win,server;app.whenReady().then(async()=>{const evidence={};try{
 const {createServer}=await import(pathToFileURL(path.join(ROOT,'server.mjs')));server=createServer({editor:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 win=new BrowserWindow({width:1100,height:800,show:false,frame:false,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});const wc=win.webContents,js=s=>wc.executeJavaScript(s),ready=async()=>{for(let i=0;i<200;i++){if(await js('!!(window.bluefish?.renderer&&bluefish.motion.current)'))return;await wait(50);}throw Error('Renderer not ready');},shot=async n=>fs.writeFileSync(path.join(OUT,n+'.png'),(await wc.capturePage()).toPNG());
 evidence.editor=[];
 for(const name of ['snub_l','snub_r']){
  await win.loadURL(base+'/?preview='+name+'&at=1.2');await ready();await wait(100);const s=await js('({...bluefish.motion.current})');assert.ok(s.reluctant&&s.sideEye>.99&&s.left===.5);assert.equal(Math.sign(s.gx),name==='snub_l'?-1:1);await shot('editor-'+name);evidence.editor.push({name,gx:s.gx,shiftX:s.shiftX,left:s.left});
 }
 evidence.desktop=[];
 for(const size of [150,460])for(const docked of [true,false])for(const dir of [-1,1]){
  const l=dock.layout(size,docked);win.setContentSize(l.width,l.height);await win.loadURL(base+'/overlay.html');await ready();wc.send('state',{size,docked,follow:true,idle:false,reduced:false,pose:{yaw:0,pitch:0,roll:0}});await wait(100);
  await js(`(()=>{const b=bluefish,m=b.motion;b.pause(true);m.reset();m.attention.reluctance.random=()=>0;m.attention.droop=1;m.attention.lastNear=-30;m.attention.lastClock=null;m.attention.update(0,{follow:true});m.step(0);b.setPointer({x:-900,y:-900,gx:0,gy:0});b.pause(false);})()`);
  for(let i=0;i<23;i++){await js(`(()=>{const b=bluefish,p=b.position(),s=b.state.size;b.setPointer({x:p.left+s*(.5-(${dir})*.46)+${i%2},y:p.top+s*.53,gx:${-dir}*.3,gy:0});})()`);await wait(50);}
  await js('bluefish.pause(true)');const s=await js('({...bluefish.motion.current})');assert.ok(s.reluctant&&s.sideEye>.99&&s.left===.5);assert.equal(Math.sign(s.gx),dir);assert.ok(Math.abs(s.shiftX-dir*.025)<1e-7);assert.ok(s.movementBlocked&&!s.sleeping);await shot('desktop-'+size+'-'+docked+'-'+dir);evidence.desktop.push({size,docked,dir,gx:s.gx,shiftX:s.shiftX,left:s.left});
 }
 evidence.passed=true;console.log(JSON.stringify(evidence));
}catch(error){evidence.error=error.stack;console.error(error);process.exitCode=1;}finally{fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(evidence,null,2));win?.destroy();server?.close();app.exit(process.exitCode||0);}});
