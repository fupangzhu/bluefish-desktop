const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');const dock=require('../desktop/dock.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'.test-output/peek-wake');fs.mkdirSync(OUT,{recursive:true});app.setPath('userData',path.join(OUT,'profile'));app.commandLine.appendSwitch('force-device-scale-factor','1.5');
const preload=path.join(OUT,'preload.cjs');fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('pet',{onState:cb=>ipcRenderer.on('state',(_e,p)=>cb(p)),onPointer:()=>{},onAction:()=>{},setInteractive:()=>{},drag:()=>{},menu:()=>{},zoom:()=>{}});`);
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win,server;
app.whenReady().then(async()=>{const evidence={};try{
 const {createServer}=await import(pathToFileURL(path.join(ROOT,'server.mjs')));server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 win=new BrowserWindow({width:782,height:782,show:false,frame:false,transparent:true,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});const wc=win.webContents,js=s=>wc.executeJavaScript(s);
 await win.loadURL(base+'/overlay.html');for(let i=0;i<200;i++){if(await js('!!(window.bluefish?.renderer&&bluefish.motion.current)'))break;await wait(100);}
 const shot=async name=>fs.writeFileSync(path.join(OUT,name+'.png'),(await wc.capturePage()).toPNG());
 const config=async(size,docked)=>{const l=dock.layout(size,docked);win.setContentSize(l.width,l.height);wc.send('state',{size,docked,follow:false,idle:true,reduced:false,pose:{yaw:0,pitch:0,roll:0}});await wait(180);
  await js(`(()=>{const b=bluefish,m=b.motion;b.pause(true);m.reset();m.attention.lastInteraction=-601;m.attention.droop=1;m.attention.lastNear=-30;m.wake.random=()=>.95;for(let i=0;i<360;i++){m.attention.update(1/60,{});m.step(1/60);}b.setPointer({x:-900,y:-900,gx:0,gy:0});b.pause(false);})()`);await wait(120);};
 const snap=()=>js(`(()=>{const b=bluefish,m=b.motion.current;return {sleeping:m.sleeping,sleep:m.sleep,left:m.left,right:m.right,preset:m.wakePreset,elapsed:b.motion.wake.elapsed,y:b.position().top,earL:m.earMoodL,ear:m.earMood,rub:m.rubEyes,wakeId:b.motion.attention.current.wakeId,blocked:m.movementBlocked,clock:b.motion.attention.idleTime};})()`);
 const click=async()=>{const p=await js('(()=>{const b=bluefish,p=b.position(),s=b.state.size;return {x:Math.round(p.left+s*.5),y:Math.round(p.top+s*.46)};})()');assert.ok(await js(`bluefish.hitTest(${p.x},${p.y})`));wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});};
 evidence.peek=[];
 for(const size of [150,460])for(const docked of [false,true]){
  await config(size,docked);const baseline=await snap();await shot(size+'-'+docked+'-asleep');await click();let peak=null;
  for(let i=0;i<65;i++){await wait(50);const s=await snap();assert.ok(s.sleeping&&s.sleep===1&&s.blocked);assert.equal(s.right,0);assert.equal(s.wakeId,baseline.wakeId);assert.ok(Math.abs(s.y-baseline.y)<.01);if(s.left>.2&&s.earL>.4&&!peak){peak=s;await shot(size+'-'+docked+'-peek');}}
  const end=await snap();assert.ok(peak);assert.equal(end.preset,null);assert.equal(end.left,0);assert.equal(end.sleeping,true);
  await js(`bluefish.motion.wake.random=()=>${docked?.95:.1};true`);await click();await wait(100);const second=await snap();assert.equal(second.sleeping,false);assert.equal(second.preset,docked?'rubeyes':'gentle');evidence.peek.push({size,docked,peak,end,second});
  if(size===460&&docked){await wait(2100);await shot('second-click-rub');}
 }
 // An interrupting second click during the peek also must wake, without waiting for its end.
 await config(460,false);await click();await wait(700);assert.equal((await snap()).preset,'peek');await click();await wait(100);assert.equal((await snap()).preset,'rubeyes');assert.equal((await snap()).sleeping,false);
 // Real-time proof at the user's 150px size: first ear pulse, breath and side drift.
 await config(150,true);await js('bluefish.motion.doze.reset();bluefish.motion.doze.random=()=>0;true');const started=Date.now();let ear=null,minBreath=Infinity,maxBreath=-Infinity,minWag=0,maxWag=0,earShot=false;
 while(Date.now()-started<38500){await wait(35);const s=await js('(()=>{const b=bluefish,m=b.motion.current,l=b.renderer.byName.get("face"),p=b.renderer.project(1000,1400,m,l);return {sleep:m.sleep,sleeping:m.sleeping,breathY:p[1]*b.state.size/2,wag:m.ahogeWag,ear:m.earTwitchL||m.earTwitchR,doze:b.motion.doze.time};})()');assert.ok(s.sleeping&&s.sleep===1);minBreath=Math.min(minBreath,s.breathY);maxBreath=Math.max(maxBreath,s.breathY);minWag=Math.min(minWag,s.wag);maxWag=Math.max(maxWag,s.wag);
  if(s.ear&&!ear){ear={...s.ear,observedAfter:(Date.now()-started)/1000};if(!earShot){earShot=true;await js('bluefish.pause(true)');await shot('sleep-ear-150');await js('bluefish.pause(false)');}}
 }
 assert.ok(ear&&ear.observedAfter>=19&&ear.observedAfter<23);assert.ok(maxBreath-minBreath>.6&&maxBreath-minBreath<.7);assert.ok(minWag<-1&&maxWag>.4);await shot('sleep-drift-150');evidence.micro={ear,breathRangePx:maxBreath-minBreath,minWag,maxWag,seconds:(Date.now()-started)/1000};
 evidence.passed=true;console.log(JSON.stringify(evidence));
}catch(error){evidence.error=error.stack;console.error(error);process.exitCode=1;}finally{fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(evidence,null,2));win?.destroy();server?.close();app.exit(process.exitCode||0);}});
