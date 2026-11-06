const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),dock=require('../desktop/dock.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'.test-output/editor-runtime');fs.mkdirSync(OUT,{recursive:true});app.setPath('userData',path.join(OUT,'profile'));
const preload=path.join(OUT,'preload.cjs');fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('pet',{onState:cb=>ipcRenderer.on('state',(_e,p)=>cb(p)),onPointer:()=>{},onAction:()=>{},setInteractive:()=>{},drag:()=>{},menu:()=>{},zoom:()=>{}});`);
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win,server;
app.whenReady().then(async()=>{const evidence={};try{
 const {createServer}=await import(pathToFileURL(path.join(ROOT,'server.mjs')));server=createServer({editor:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 win=new BrowserWindow({width:1100,height:800,show:false,frame:false,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});const wc=win.webContents,js=s=>wc.executeJavaScript(s);const ready=async()=>{for(let i=0;i<200;i++){if(await js('!!(window.bluefish?.renderer&&bluefish.motion.current)'))return;await wait(100);}throw Error('Renderer not ready');};
 const shot=async name=>fs.writeFileSync(path.join(OUT,name+'.png'),(await wc.capturePage()).toPNG());
 const components=async(selector)=>js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,seen=new Uint8Array(c.width*c.height),q=new Int32Array(seen.length),out=[];for(let k=0;k<seen.length;k++){if(seen[k]||d[k*4+3]<80)continue;let head=0,tail=0,sx=0,sy=0;seen[k]=1;q[tail++]=k;while(head<tail){const p=q[head++],x=p%c.width,y=(p/c.width)|0;sx+=x;sy+=y;for(const v of [x?p-1:-1,x<c.width-1?p+1:-1,y?p-c.width:-1,y<c.height-1?p+c.width:-1])if(v>=0&&!seen[v]&&d[v*4+3]>=80){seen[v]=1;q[tail++]=v;}}if(tail>20)out.push({pixels:tail,x:sx/tail/(c.width/c.clientWidth),y:sy/tail/(c.height/c.clientHeight)});}return out;})()`);
 await win.loadURL(base+'/?preview=rub_l&at=2.5');await ready();await wait(100);assert.equal(await js('document.querySelectorAll("[data-preview]").length'),16);assert.equal(await js('bluefish.motion.current.rubHand'),0);assert.ok(await js('bluefish.motion.current.rubEyes>.9'));evidence.editorLeft=await components('#stage canvas:not(#avatar)');assert.equal(evidence.editorLeft.length,1);await shot('editor-left-rub');
 await js('document.querySelector("[data-preview=rub_r]").click();document.querySelector("#previewPlay").click();const t=document.querySelector("#previewTimeline");t.value=2.5;t.dispatchEvent(new Event("input",{bubbles:true}));');await wait(100);assert.equal(await js('bluefish.motion.current.rubHand'),1);assert.ok(await js('Math.abs(bluefish.preview.time-2.5)<.02'));evidence.editorRight=await components('#stage canvas:not(#avatar)');assert.equal(evidence.editorRight.length,1);assert.ok(evidence.editorRight[0].x>evidence.editorLeft[0].x);await shot('editor-right-rub');
 for(const [name,t] of [['peek',.8],['ear_l',.05],['ear_r',.05],['sleep',21],['hair_ltr',5],['breath',5],['blink',.08],['normal',5]]){
  await js(`document.querySelector('[data-preview=${name}]').click();bluefish.preview.playing=false;bluefish.preview.seek(${t});`);await wait(60);const s=await js('({left:bluefish.motion.current.left,right:bluefish.motion.current.right,sleeping:bluefish.motion.current.sleeping,preset:bluefish.motion.current.wakePreset})');if(name==='peek'){assert.ok(s.sleeping&&s.left>.2&&s.right===0);await shot('editor-peek');}if(name==='normal')assert.equal(s.sleeping,false);
 }
 for(const [name,t] of [['tug_guard',.9],['bonk',.22],['bonk',1.5],['bonk',4]]){
  await js(`document.querySelector('[data-preview=${name}]').click();bluefish.preview.playing=false;bluefish.preview.seek(${t});`);await wait(80);
  const gesture=await js('({guard:bluefish.motion.current.guard,duck:bluefish.motion.current.duck,pull:!!bluefish.renderer.ahogePose})');
  const hands=await components('#stage canvas:not(#avatar)');
  if(t<1){assert.ok(gesture.guard>.9);assert.equal(hands.length,2);if(name==='tug_guard')assert.ok(gesture.pull);await shot('editor-'+name);}
  if(t===1.5){assert.equal(gesture.duck,1);assert.equal(hands.length,0);assert.equal(await js('document.querySelector("#avatar").style.opacity'),'0');}
  if(t===4){assert.equal(gesture.duck,0);assert.equal(await js('document.querySelector("#avatar").style.opacity'),'1');}
 }
 await js('document.querySelector("#size").value=150;document.querySelector("#size").dispatchEvent(new Event("input",{bubbles:true}));');await wait(100);assert.equal(await js('bluefish.renderer.canvas.clientWidth'),150);
 await win.loadURL(base+'/menu.html');await wait(200);assert.equal(await js('document.querySelectorAll("[data-action]").length'),0);assert.equal(await js('document.querySelectorAll("[data-command=open-console]").length'),0);assert.equal(await js('document.querySelectorAll("[aria-pressed]").length'),3);await shot('menu');
 evidence.desktopHands=[];
 for(const docked of [true,false])for(const [draw,hand] of [[.66,0],[.8,1]]){
  const size=460,l=dock.layout(size,docked);win.setContentSize(l.width,l.height);await win.loadURL(base+'/overlay.html');await ready();wc.send('state',{size,docked,follow:false,idle:false,reduced:false,pose:{yaw:0,pitch:0,roll:0}});await wait(120);
  await js(`(()=>{const b=bluefish,m=b.motion;b.pause(true);m.reset();m.wake.random=()=>${draw};m.attention.lastInteraction=-601;m.attention.droop=1;m.attention.lastNear=-30;for(let i=0;i<360;i++){m.attention.update(1/60,{});m.step(1/60);}b.setPointer({x:-900,y:-900,gx:0,gy:0});b.pause(false);})()`);await wait(80);
  const p=await js('(()=>{const b=bluefish,p=b.position();return {x:Math.round(p.left+230),y:Math.round(p.top+460*.46)};})()');assert.ok(await js(`bluefish.hitTest(${p.x},${p.y})`));wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});
  for(let i=0;i<100;i++){if(await js('bluefish.motion.current.rubEyes>.99'))break;await wait(30);}assert.equal(await js('bluefish.motion.current.rubHand'),hand);assert.ok(await js('bluefish.motion.current.rubEyes>.99'));await js('bluefish.pause(true)');const blobs=await components('#hands');assert.equal(blobs.length,docked?2:1,JSON.stringify({docked,hand,blobs}));if(docked){const ys=blobs.map(b=>b.y).sort((a,b)=>a-b);assert.ok(ys[1]-ys[0]>20);}await shot('desktop-'+docked+'-'+hand);evidence.desktopHands.push({docked,hand,blobs});
  if(docked&&hand===0){
   const relative=async handBlob=>{const p=await js('bluefish.position()');return {x:handBlob.x-p.left,y:handBlob.y-p.top};};
   const before=await relative(blobs.reduce((a,b)=>a.y<b.y?a:b));
   const floating=dock.layout(size,false);win.setContentSize(floating.width,floating.height);
   wc.send('state',{size,docked:false});await wait(160);
   const lifted=await components('#hands');assert.equal(lifted.length,1);
   const after=await relative(lifted[0]);assert.ok(Math.hypot(before.x-after.x,before.y-after.y)<2,JSON.stringify({before,after}));
   evidence.undockDuringRub={before,after};await shot('desktop-undock-during-rub');
  }
 }
 evidence.passed=true;console.log(JSON.stringify(evidence));
}catch(error){evidence.error=error.stack;console.error(error);process.exitCode=1;}finally{fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(evidence,null,2));win?.destroy();server?.close();app.exit(process.exitCode||0);}});
