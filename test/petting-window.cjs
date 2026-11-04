// Real renderer regression for open-eye petting and inactivity sleep/wake.
const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const REPO=path.resolve(__dirname,'..'),OUT=path.join(REPO,'.test-output/petting');fs.mkdirSync(OUT,{recursive:true});app.setPath('userData',path.join(OUT,'profile'));
const preload=path.join(OUT,'preload.cjs');fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('pet',{onState:cb=>ipcRenderer.on('state',(_e,p)=>cb(p)),onPointer:()=>{},onAction:()=>{},setInteractive:()=>{},drag:()=>{},menu:()=>{},zoom:()=>{}});`);
app.commandLine.appendSwitch('force-device-scale-factor','1.5');const sleep=ms=>new Promise(r=>setTimeout(r,ms));let win,server;
app.whenReady().then(async()=>{const evidence={};try{
 const {createServer}=await import(pathToFileURL(path.join(REPO,'server.mjs')));server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 win=new BrowserWindow({width:420,height:420,show:false,frame:false,transparent:true,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});const wc=win.webContents,js=s=>wc.executeJavaScript(s);
 await win.loadURL('http://127.0.0.1:'+server.address().port+'/overlay.html');for(let i=0;i<100;i++){if(await js('!!window.bluefish?.renderer'))break;await sleep(100);}
 const shot=async name=>fs.writeFileSync(path.join(OUT,name+'.png'),(await wc.capturePage()).toPNG());
 const snap=()=>js(`(()=>{const b=bluefish,m=b.motion.current;return {reaction:m.rubReaction,left:m.left,right:m.right,yaw:m.yaw,roll:m.roll,wag:m.ahogeWag,sleep:m.sleep,sleeping:m.sleeping,ear:m.earMood,y:b.position().top,hands:b.last.hands,blocked:m.movementBlocked};})()`);
 for(const docked of [false,true]){
  const mode=docked?'docked':'free',peaks={};
  for(const [reaction,draw] of [['playful',.4],['subtle',.85]]){
   wc.send('state',{size:400,docked,follow:true,idle:false,reduced:false,pose:{yaw:0,pitch:0,roll:0}});await sleep(100);
   await js(`bluefish.motion.reset();bluefish.motion.attention.random=()=>${draw};bluefish.setPointer({x:-900,y:-900,gx:0,gy:0});`);
   if(reaction==='subtle')await js('bluefish.forceSulk()');
   const peak={yaw:0,roll:0,wag:0};
   for(let i=0;i<86;i++){
    await js(`(()=>{const b=bluefish,p=b.position(),s=b.state.size,x=Math.sin(${i}*.25);b.setPointer({x:p.left+s*(.5+x*.12),y:p.top+s*.44,gx:x*.7,gy:0});})()`);await sleep(50);
    if(i>25){const s=await snap();assert.equal(s.reaction,reaction);assert.ok(s.left>.99&&s.right>.99,mode+' '+reaction+' closed its eyes');if(i>40){peak.yaw=Math.max(peak.yaw,Math.abs(s.yaw));peak.roll=Math.max(peak.roll,Math.abs(s.roll));}peak.wag=Math.max(peak.wag,Math.abs(s.wag));}
    if(i===30||i===55||i===80)await shot(mode+'-'+reaction+'-'+i);
   }
   peaks[reaction]=peak;console.log(mode+' '+reaction+' '+JSON.stringify(peak));
  }
  evidence[mode+'Petting']=peaks;assert.ok(peaks.playful.wag>4);assert.equal(peaks.subtle.wag,0);assert.ok(peaks.playful.yaw>peaks.subtle.yaw*1.8);evidence[mode+'Petting']=peaks;
  await js('bluefish.motion.reset();bluefish.setPointer({x:-900,y:-900,gx:0,gy:0});bluefish.forceSulk();bluefish.motion.attention.lastNear-=30;bluefish.motion.attention.lastMove-=30;bluefish.motion.attention.droop=1');await sleep(800);const droop=await snap();await shot(mode+'-droop');
  await js('bluefish.motion.attention.random=()=>1;bluefish.motion.attention.lastInteraction=bluefish.motion.attention.idleTime-601');
  for(let i=0;i<90;i++){await js('bluefish.setPointer({x:-900,y:-900,gx:0,gy:0})');await sleep(50);}
  const asleep=await snap();await shot(mode+'-asleep');assert.ok(asleep.sleeping&&asleep.sleep===1&&asleep.left===0&&asleep.right===0&&asleep.ear<-.99);assert.ok(asleep.y-droop.y>400*(docked?.075:.02));
  let opened=false,rose=false;
  for(let i=0;i<150;i++){
   await js(`(()=>{const b=bluefish,p=b.position(),s=b.state.size;b.setPointer({x:p.left+s*(.85+Math.sin(${i}*.2)*.03),y:p.top+s*.25,gx:.5,gy:0});})()`);await sleep(40);const s=await snap();
   opened||=s.left>.99&&s.right>.99;
   if(asleep.y-s.y>.01){assert.ok(opened,'head rose before eyes reopened');rose=true;}
   if(s.sleep===0&&!s.blocked)break;
  }
  const awake=await snap();await shot(mode+'-awake');assert.ok(opened&&rose&&!awake.sleeping&&awake.sleep===0);evidence[mode+'Sleep']={loweredBy:asleep.y-droop.y,asleep,awake};
 }
 evidence.passed=true;console.log(JSON.stringify(evidence));
}catch(error){evidence.error=error.stack;console.error(error);process.exitCode=1;}finally{fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(evidence,null,2));server?.close();app.exit(process.exitCode||0);}});
