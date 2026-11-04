// Electron regression: finish reopening before gaze turns or taskbar travel resume.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const REPO=path.resolve(__dirname,'..'),OUT=path.join(REPO,'.test-output/wake');
fs.mkdirSync(OUT,{recursive:true});app.setPath('userData',path.join(OUT,'profile'));
const preload=path.join(OUT,'preload.cjs');
fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('pet',{onState:cb=>ipcRenderer.on('state',(_e,p)=>cb(p)),onPointer:()=>{},onAction:()=>{},setInteractive:()=>{},drag:()=>{},menu:()=>{},zoom:()=>{}});`);
app.commandLine.appendSwitch('force-device-scale-factor','1.5');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let win,server;
app.whenReady().then(async()=>{
 const evidence={};try{
  const {createServer}=await import(pathToFileURL(path.join(REPO,'server.mjs')));server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  win=new BrowserWindow({width:420,height:420,show:false,frame:false,transparent:true,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
  const wc=win.webContents,js=s=>wc.executeJavaScript(s);
  await win.loadURL('http://127.0.0.1:'+server.address().port+'/overlay.html');
  for(let i=0;i<100;i++){if(await js('!!window.bluefish?.renderer'))break;await sleep(100);}
  const shot=async name=>fs.writeFileSync(path.join(OUT,name+'.png'),(await wc.capturePage()).toPNG());
  const snapshot=()=>js(`(()=>{const b=bluefish,m=b.motion.current,p=b.position();return {left:m.left,right:m.right,yaw:m.yaw,pitch:m.pitch,roll:m.roll,x:p.left,y:p.top,offset:b.last.offsetX,hands:b.last.hands,blocked:m.movementBlocked,relax:m.relax,time:b.motion.attention.time,until:b.motion.attention.restUntil};})()`);
  for(const docked of [false,true]){
   const name=docked?'docked':'free';
   wc.send('state',{size:400,docked,follow:true,idle:false,reduced:false,pose:{yaw:0,pitch:0,roll:0}});await sleep(150);
   await js('bluefish.motion.reset();bluefish.motion.attention.random=()=>0;bluefish.motion.nextBlink=Infinity');
   if(docked){await js('bluefish.peek.forceStep(1)');await sleep(160);}
   let relaxed;
   for(let i=0;i<180;i++){
    await js(`(()=>{const b=bluefish,p=b.position(),s=b.state.size,x=Math.sin(${i}*.25);b.setPointer({x:p.left+s*(.5+x*.12),y:p.top+s*.44,gx:x*.7,gy:0});})()`);await sleep(50);
    relaxed=await snapshot();if(i>85&&relaxed.relax>.999&&relaxed.left<.001&&relaxed.right<.001)break;
   }
   assert.ok(relaxed.left<.001&&relaxed.right<.001&&relaxed.blocked);await shot(name+'-relaxed');
   let held,opened,moved,samples=0;
   for(let i=0;i<260;i++){
    await js(`(()=>{const b=bluefish,p=b.position(),s=b.state.size;b.setPointer({x:p.left+s*(1+Math.sin(${i}*.25)*.02),y:p.top+s*.55,gx:.8,gy:0});})()`);await sleep(40);
    const s=await snapshot();held??=s;samples++;
    const open=s.left>=1-1e-6&&s.right>=1-1e-6;
    if(open&&!opened){opened=s;await shot(name+'-reopened');}
    if(!opened){
     for(const key of ['yaw','pitch','roll','x','y','offset'])assert.ok(Math.abs(s[key]-held[key])<1e-6,name+' moved before reopening: '+key);
     assert.deepEqual(s.hands,held.hands,name+' hands moved before reopening');
    }
    if(Math.abs(s.yaw-held.yaw)>.1||Math.abs(s.offset-held.offset)>.1){assert.ok(opened&&s.time>opened.time+.05,name+' moved before the reopening pause finished');moved??=s;}
    if(opened&&moved&&s.time>opened.time+1.6)break;
   }
   assert.ok(opened&&moved,name+' never resumed');assert.ok(opened.time-held.time>=2,name+' lost the 2s minimum rest');
   if(docked)assert.ok(Math.abs(moved.offset-held.offset)>.1||Math.abs((await snapshot()).offset-held.offset)>.1,'taskbar step never resumed');
   evidence[name]={samples,holdStarted:held.time,eyesOpened:opened.time,firstMovement:moved.time,wait:opened.time-held.time};await shot(name+'-moving');
  }
  evidence.passed=true;console.log(JSON.stringify(evidence));
 }catch(error){evidence.error=error.stack;console.error(error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(evidence,null,2));server?.close();app.exit(process.exitCode||0);}
});
