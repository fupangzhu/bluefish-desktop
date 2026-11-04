const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const REPO=path.resolve(__dirname,'..'),OUT=path.join(REPO,'.test-output/reactions');fs.mkdirSync(OUT,{recursive:true});app.setPath('userData',path.join(OUT,'profile'));
const preload=path.join(OUT,'preload.cjs');fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('pet',{onState:cb=>ipcRenderer.on('state',(_e,p)=>cb(p)),onPointer:()=>{},onAction:()=>{},setInteractive:()=>{},drag:()=>{},menu:()=>{},zoom:()=>{}});`);
app.commandLine.appendSwitch('force-device-scale-factor','1.5');let win,server;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{const evidence={};try{
 const {createServer}=await import(pathToFileURL(path.join(REPO,'server.mjs')));server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 win=new BrowserWindow({width:420,height:420,show:false,frame:false,transparent:true,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});const wc=win.webContents,js=s=>wc.executeJavaScript(s);
 await win.loadURL('http://127.0.0.1:'+server.address().port+'/overlay.html');for(let i=0;i<100;i++){if(await js('!!window.bluefish?.renderer'))break;await sleep(100);}
 wc.send('state',{size:400,docked:false,follow:true,idle:false,reduced:false,pose:{yaw:0,pitch:0,roll:0}});await sleep(250);
 const shot=async name=>fs.writeFileSync(path.join(OUT,name+'.png'),(await wc.capturePage()).toPNG());
 await shot('normal');let early=0;
 for(let i=0;i<88;i++){const t=i*.05;await js(`(()=>{const b=bluefish,p=b.position(),s=b.state.size,x=Math.sin(${t}*5);b.setPointer({x:p.left+s*(.5+x*.12),y:p.top+s*.44,gx:x*.7,gy:0});})()`);await sleep(50);if(i<30)early=Math.max(early,Math.abs(await js('bluefish.motion.current.yaw')));if(i===20)await shot('rubbing');}
 evidence.rub=await js('({left:bluefish.motion.current.left,yaw:bluefish.motion.current.yaw,relax:bluefish.motion.attention.current.relax})');evidence.rub.earlyYaw=early;await shot('relaxed');assert.ok(evidence.rub.left<.02);assert.ok(evidence.rub.relax>.99);assert.ok(Math.abs(evidence.rub.yaw)<.1);assert.ok(early>.2);
 const depart=async i=>{await js(`(()=>{const b=bluefish,p=b.position(),s=b.state.size;b.setPointer({x:p.left+s*(1.0+Math.sin(${i}*.3)*.02),y:p.top+s*.55,gx:.8,gy:0});})()`);await sleep(50);};
 await depart(0);evidence.departure=await js('({time:bluefish.motion.attention.time,until:bluefish.motion.attention.restUntil,resting:bluefish.motion.attention.current.resting})');
 const until=evidence.departure.until,remaining=until-evidence.departure.time;assert.ok(evidence.departure.resting&&remaining>=1.8&&remaining<=5);
 for(let i=1;i<30;i++)await depart(i);
 evidence.held=await js('({left:bluefish.motion.current.left,right:bluefish.motion.current.right,resting:bluefish.motion.attention.current.resting,until:bluefish.motion.attention.restUntil})');await shot('departure-hold');assert.ok(evidence.held.resting&&evidence.held.left<.02&&evidence.held.right<.02);assert.equal(evidence.held.until,until);
 for(let i=30;i<250;i++){await depart(i);if(await js('bluefish.motion.attention.time')>until+1.5)break;}
 evidence.recovered=await js('({left:bluefish.motion.current.left,right:bluefish.motion.current.right,yaw:bluefish.motion.current.yaw,resting:bluefish.motion.attention.current.resting})');await shot('recovered');assert.ok(evidence.recovered.left>.95&&evidence.recovered.right>.95&&evidence.recovered.yaw>4&&!evidence.recovered.resting);
 await js('bluefish.motion.attention.lastNear-=30;bluefish.motion.attention.lastMove-=30');for(let i=0;i<35;i++){await js('bluefish.setPointer({...bluefish.pointer})');await sleep(50);}
 evidence.still=await js('({gx:bluefish.motion.current.gx,droop:bluefish.motion.current.ahogeDroop,weight:bluefish.motion.attention.current.gazeWeight})');await shot('droop');assert.ok(Math.abs(evidence.still.gx)<.08&&evidence.still.droop>.8);
 await js('bluefish.pause();bluefish.motion.reset();bluefish.motion.step(0)');
 for(let i=0;i<14;i++){await js(`(()=>{const b=bluefish;b.renderer.render({...b.motion.current,earTwitchL:{elapsed:${i}/120,count:1,period:.115,amplitude:1},earMood:0});})()`);await shot('ear-'+String(i).padStart(2,'0'));}
 evidence.passed=true;console.log(JSON.stringify(evidence));
}catch(e){evidence.error=e.stack;console.error(e);process.exitCode=1;}finally{fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(evidence,null,2));server?.close();app.exit(process.exitCode||0);}});
