const {app,BrowserWindow,ipcMain,screen,globalShortcut,Tray,nativeImage}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const {createDrag,dragBounds}=require('./drag.cjs');
const dock=require('./dock.cjs');
app.setName('Bluefish Complete');
app.setAppUserModelId('com.fupangzhu.bluefish');
const APP_ICON=path.join(__dirname,'../assets/icon.ico');
app.setPath('userData',path.join(app.getPath('appData'),'bluefish-complete'));
const MENU_W=280,POSE_LIMIT={yaw:[-8,18],pitch:[-12,12],roll:[-10,10]};   // yaw left is shallower: the art flattens when turned left
const ACTIONS=new Set(['blink','wink','nod','shakehead','happy','reset']);
const COMMANDS=new Set(['open-console','toggle-visible','reset-position','quit','close-menu']);
const SMOKE=process.env.BLUEFISH_SMOKE==='1';
const alive=w=>!!w&&!w.isDestroyed();
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
let win,menuWin,consoleWin,server,timer,topTimer,drag=null,tray,saveTimer;
let lastSet=null,menuAnchor={x:0,y:0},menuShownAt=0,menuHeight=400;
// Main owns the settings; every change is broadcast to pet, menu and console.
const state={size:dock.DEFAULT_SIZE,docked:true,follow:true,idle:true,reduced:false,pose:{yaw:0,pitch:0,roll:0}};
const snapshot=()=>JSON.parse(JSON.stringify(state));
if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>{if(alive(win))win.showInactive();});
app.whenReady().then(async()=>{
  const {createServer}=await import('../server.mjs');server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port;
  const stateFile=path.join(app.getPath('userData'),'window.json');
  let saved=null;
  try{
    const p=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    if(typeof p.size==='number')state.size=dock.clampSize(p.size);
    for(const k of ['docked','follow','idle'])if(typeof p[k]==='boolean')state[k]=p[k];
    if(Number.isFinite(p.x)&&Number.isFinite(p.y))saved={x:Math.round(p.x),y:Math.round(p.y)};
  }catch{}

  // ---- geometry -------------------------------------------------------------------
  function homeBounds(){
    const d=screen.getPrimaryDisplay(),a=d.workArea,cx=dock.homeCenterX(a);
    return state.docked?dock.dockedBounds(a,d.bounds,state.size,cx):dock.freeBounds(a,state.size,{x:cx,y:a.y+a.height-12-state.size/2});
  }
  function initialBounds(){
    if(!saved)return homeBounds();
    const displays=screen.getAllDisplays(),L=dock.layout(state.size,state.docked);
    if(state.docked){
      const cx=saved.x+L.width/2,d=displays.find(d=>cx>=d.bounds.x&&cx<=d.bounds.x+d.bounds.width);
      return d?dock.dockedBounds(d.workArea,d.bounds,state.size,cx):homeBounds();
    }
    const fits=displays.some(d=>{const a=d.workArea;return saved.x>=a.x&&saved.y>=a.y&&saved.x+L.width<=a.x+a.width&&saved.y+L.height<=a.y+a.height;});
    return fits?{x:saved.x,y:saved.y,width:L.width,height:L.height}:homeBounds();
  }
  const start=initialBounds();
  lastSet={...start};
  win=new BrowserWindow({...start,minWidth:start.width,minHeight:start.height,maxWidth:start.width,maxHeight:start.height,title:'蓝色肥鱼',icon:APP_ICON,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,resizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});

  function save(){
    if(SMOKE)return;
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      if(!alive(win))return;
      const b=lastSet||win.getBounds();
      try{fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile,JSON.stringify({x:b.x,y:b.y,size:state.size,docked:state.docked,follow:state.follow,idle:state.idle}));}catch{}
    },180);
  }
  function broadcast(){
    const s=snapshot();
    for(const w of [win,menuWin,consoleWin])if(alive(w))w.webContents.send('state',s);
  }
  function updateTop(){
    if(!alive(win))return;
    if(state.docked)win.setAlwaysOnTop(true,'screen-saver');else win.setAlwaysOnTop(true);
  }
  // Move/resize the pet window. Min/max are released while the size changes (as the
  // old scale() did) so Windows never fights the new size, then locked again.
  function applyBounds(b){
    const resized=!lastSet||lastSet.width!==b.width||lastSet.height!==b.height;
    if(resized){win.setMinimumSize(1,1);win.setMaximumSize(b.width,b.height);}
    win.setBounds(b);
    if(resized)win.setMinimumSize(b.width,b.height);
    lastSet={x:b.x,y:b.y,width:b.width,height:b.height};
    save();
  }
  // Re-lay-out after a size/mode/display change, keeping the anchor:
  // docked keeps bottom edge + center x, free keeps the center.
  function relayout(fromDocked=false){
    const cur=lastSet||win.getBounds(),cx=cur.x+cur.width/2,cy=cur.y+cur.height/2;
    const d=screen.getDisplayNearestPoint({x:Math.round(cx),y:Math.round(cy)}),a=d.workArea;
    let b;
    if(state.docked)b=dock.dockedBounds(a,d.bounds,state.size,cx);
    else{
      const L=dock.layout(state.size,false);
      b=dock.freeBounds(a,state.size,{x:cx,y:fromDocked?a.y+a.height-12-L.height/2:cy});
    }
    updateTop();applyBounds(b);
    if(drag){const active=drag.active;drag=createDrag(screen.getCursorScreenPoint(),lastSet,{lockY:state.docked});drag.active=active;}
  }

  // ---- state ----------------------------------------------------------------------
  function applyPatch(patch){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))return;
    const before=JSON.stringify(state),wasDocked=state.docked,oldSize=state.size;
    if(typeof patch.size==='number'&&Number.isFinite(patch.size))state.size=dock.clampSize(patch.size);
    for(const k of ['docked','follow','idle','reduced'])if(typeof patch[k]==='boolean')state[k]=patch[k];
    if(patch.pose&&typeof patch.pose==='object'){
      for(const [k,lim] of Object.entries(POSE_LIMIT)){const v=patch.pose[k];if(typeof v==='number'&&Number.isFinite(v))state.pose[k]=clamp(v,lim[0],lim[1]);}
      if(typeof patch.follow!=='boolean')state.follow=false;
    }
    if(JSON.stringify(state)===before)return;
    if(state.size!==oldSize||state.docked!==wasDocked)relayout(wasDocked&&!state.docked);
    broadcast();save();
  }
  const sendPet=(channel,payload)=>{if(alive(win))win.webContents.send(channel,payload);};
  function doAction(name){
    if(!ACTIONS.has(name))return;
    if(name==='reset')applyPatch({pose:{yaw:0,pitch:0,roll:0},follow:true});
    sendPet('action',name);
  }
  function toggleVisibility(){
    drag=null;hideMenu();
    if(win.isVisible())win.hide();else win.showInactive();
  }
  function resetPosition(){
    drag=null;
    const wasDocked=state.docked;state.docked=true;
    updateTop();applyBounds(homeBounds());
    if(!win.isVisible())win.showInactive();
    sendPet('action','reset');
    if(!wasDocked)broadcast();
    save();
  }

  // ---- windows ----------------------------------------------------------------------
  function harden(wc){
    wc.setWindowOpenHandler(()=>({action:'deny'}));
    wc.on('will-navigate',(e,url)=>{if(!url.startsWith(base+'/'))e.preventDefault();});
    wc.on('did-finish-load',()=>wc.setVisualZoomLevelLimits(1,1).catch(()=>{}));
    wc.on('zoom-changed',()=>wc.setZoomFactor(1));
  }
  harden(win.webContents);
  const sendState=()=>sendPet('state',snapshot());
  win.webContents.on('did-finish-load',()=>{sendState();setTimeout(sendState,1500);});
  await win.loadURL(base+'/overlay.html');
  updateTop();win.showInactive();

  function placeMenu(){
    const a=screen.getDisplayNearestPoint(menuAnchor).workArea;
    menuWin.setBounds(dock.popupPosition(menuAnchor,{width:MENU_W,height:menuHeight},a));
  }
  function hideMenu(){if(alive(menuWin)&&menuWin.isVisible())menuWin.hide();}
  function createMenu(){
    menuWin=new BrowserWindow({width:MENU_W,height:menuHeight,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,show:false,title:'蓝色肥鱼菜单',webPreferences:{preload:path.join(__dirname,'control-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    menuWin.setAlwaysOnTop(true,'screen-saver');
    harden(menuWin.webContents);
    menuWin.on('blur',()=>{
      if(SMOKE)return;
      // A tray click can steal focus right after show(); take it back once.
      if(Date.now()-menuShownAt<150){if(alive(menuWin))menuWin.focus();return;}
      hideMenu();
    });
    menuWin.on('closed',()=>{menuWin=null;});
    menuWin.loadURL(base+'/menu.html').catch(()=>{});
  }
  function showMenuAt(point){
    if(!alive(menuWin))createMenu();
    drag=null;menuAnchor={x:Math.round(point.x),y:Math.round(point.y)};
    placeMenu();menuWin.webContents.send('state',snapshot());
    menuShownAt=Date.now();menuWin.show();menuWin.moveTop();menuWin.focus();
  }
  function openConsole(){
    if(alive(consoleWin)){if(consoleWin.isMinimized())consoleWin.restore();consoleWin.show();consoleWin.focus();return consoleWin;}
    consoleWin=new BrowserWindow({width:980,height:660,minWidth:760,minHeight:520,title:'蓝色肥鱼',icon:APP_ICON,titleBarStyle:'hidden',titleBarOverlay:{color:'#f2f2f2',symbolColor:'#161616',height:44},backgroundColor:'#f2f2f2',show:false,webPreferences:{preload:path.join(__dirname,'control-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    consoleWin.removeMenu();
    harden(consoleWin.webContents);
    const w=consoleWin;
    w.once('ready-to-show',()=>{if(alive(w))w.show();});
    setTimeout(()=>{if(alive(w)&&!w.isVisible())w.show();},1500);
    w.on('closed',()=>{if(consoleWin===w)consoleWin=null;});
    w.loadURL(base+'/').catch(()=>{});
    return w;
  }
  function runCommand(name){
    switch(name){
      case 'open-console':hideMenu();openConsole();break;
      case 'toggle-visible':toggleVisibility();break;
      case 'reset-position':hideMenu();resetPosition();break;
      case 'quit':app.quit();break;
      case 'close-menu':hideMenu();break;
    }
  }

  // ---- IPC (every sender is validated) ------------------------------------------------
  const petOwned=e=>alive(win)&&e.sender===win.webContents;
  const ctlOwned=e=>(alive(menuWin)&&e.sender===menuWin.webContents)||(alive(consoleWin)&&e.sender===consoleWin.webContents);
  ipcMain.on('interactive',(e,hit)=>{if(!petOwned(e)||drag)return;win.setIgnoreMouseEvents(hit!==true,{forward:true});});
  ipcMain.on('drag',(e,on)=>{
    if(!petOwned(e))return;
    if(on===true){drag=createDrag(screen.getCursorScreenPoint(),lastSet||win.getBounds(),{lockY:state.docked});win.setIgnoreMouseEvents(false);}
    else endDrag();
  });
  ipcMain.on('menu',e=>{if(petOwned(e))showMenuAt(screen.getCursorScreenPoint());});
  ipcMain.on('zoom',(e,steps)=>{
    if(!petOwned(e)||typeof steps!=='number'||!Number.isFinite(steps))return;
    const n=clamp(Math.trunc(steps),-10,10);
    if(n)applyPatch({size:state.size+n*10});
  });
  ipcMain.handle('ctl:get-state',e=>ctlOwned(e)?snapshot():null);
  ipcMain.on('ctl:set',(e,patch)=>{if(ctlOwned(e))applyPatch(patch);});
  ipcMain.on('ctl:action',(e,name)=>{if(ctlOwned(e)&&typeof name==='string')doAction(name);});
  ipcMain.on('ctl:command',(e,name)=>{if(ctlOwned(e)&&COMMANDS.has(name))runCommand(name);});
  ipcMain.on('ctl:fit',(e,height)=>{
    if(!ctlOwned(e)||!alive(menuWin)||e.sender!==menuWin.webContents||typeof height!=='number'||!Number.isFinite(height))return;
    menuHeight=clamp(Math.round(height),80,600);
    if(menuWin.isVisible())placeMenu();
  });

  // ---- dragging -------------------------------------------------------------------------
  function undock(p){
    state.docked=false;
    const d=screen.getDisplayNearestPoint(p),L=dock.layout(state.size,false);
    // Bottom edge slightly above the cursor, centered on the cursor x.
    const b=dock.freeBounds(d.workArea,state.size,{x:p.x,y:p.y-6-L.height/2});
    updateTop();applyBounds(b);
    drag=createDrag(p,b);drag.active=true;
    broadcast();save();
  }
  function endDrag(){
    const was=drag;drag=null;
    if(!was||!was.active||state.docked||!lastSet)return;
    const d=screen.getDisplayMatching(lastSet);
    if(dock.shouldDock(lastSet,d.workArea)){state.docked=true;relayout();broadcast();save();}
  }
  function dragStep(p){
    // Always use the computed size; the native size can drift by a DIP at fractional DPI.
    const L=dock.layout(state.size,state.docked),next=dragBounds(drag,p,win.getBounds(),L);
    if(state.docked){
      if(drag.active&&dock.shouldUndock(p.y-drag.point.y,state.size)){undock(p);return;}
      if(!next)return;
      const d=screen.getDisplayNearestPoint(p),b=dock.dockedBounds(d.workArea,d.bounds,state.size,next.x+L.width/2);
      if(!lastSet||b.x!==lastSet.x||b.y!==lastSet.y)applyBounds(b);
    }else if(next)applyBounds(next);
  }

  // ---- tray, timers, shortcuts ---------------------------------------------------------------
  const icon=nativeImage.createFromPath(path.join(__dirname,'../assets/icon.png')).resize({width:32,height:32,quality:'best'});
  tray=new Tray(icon);tray.setToolTip('蓝色肥鱼');
  tray.on('click',toggleVisibility);
  tray.on('right-click',()=>showMenuAt(screen.getCursorScreenPoint()));
  timer=setInterval(()=>{
    if(!alive(win))return;
    const p=screen.getCursorScreenPoint();
    if(drag)dragStep(p);
    const r=win.getContentBounds(),area=screen.getDisplayMatching(r).workArea;
    if(win.isVisible())win.webContents.send('pointer',{x:p.x-r.x,y:p.y-r.y,gx:clamp((p.x-r.x-r.width*.5)/Math.max(200,area.width*.45),-1,1),gy:clamp((p.y-r.y-r.height*.5)/Math.max(200,area.height*.45),-1,1)});
  },33);
  // Keep the docked pet above the taskbar, which also sits in the topmost band.
  topTimer=setInterval(()=>{
    if(!alive(win)||!state.docked||!win.isVisible()||(alive(menuWin)&&menuWin.isVisible()))return;
    win.moveTop();
  },2000);
  screen.on('display-removed',()=>{if(alive(win))relayout();});
  screen.on('display-metrics-changed',()=>{if(alive(win))relayout();});
  globalShortcut.register('CommandOrControl+Shift+F10',toggleVisibility);
  globalShortcut.register('CommandOrControl+Shift+F11',resetPosition);
  win.on('closed',()=>{win=null;app.quit();});
  createMenu();

  // ---- smoke ---------------------------------------------------------------------------------
  if(SMOKE){
    (async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const folder=process.env.BLUEFISH_SMOKE_DIR||path.join(__dirname,'..','.test-output');
      fs.mkdirSync(folder,{recursive:true});
      const evidence={};
      const shot=async(wc,name)=>{const img=await wc.capturePage();fs.writeFileSync(path.join(folder,name),img.toPNG());};
      const geometry=async(label,patch)=>{
        applyPatch(patch);await sleep(250);
        evidence[label]={state:snapshot(),computed:{...lastSet},native:win.getBounds(),layout:dock.layout(state.size,state.docked),alwaysOnTop:win.isAlwaysOnTop()};
      };
      try{
        let ready=false;
        for(let i=0;i<100&&!ready;i++){try{ready=await win.webContents.executeJavaScript('!!window.bluefish');}catch{}if(!ready)await sleep(100);}
        evidence.ready=ready;
        await sleep(600);
        evidence.state=snapshot();
        await geometry('docked150',{size:150,docked:true});
        await geometry('docked460',{size:460,docked:true});
        await geometry('free240',{size:240,docked:false});
        await sleep(300);await shot(win.webContents,'smoke-pet-free.png');
        await geometry('docked240',{size:240,docked:true});
        await sleep(300);await shot(win.webContents,'smoke-pet-docked.png');
        try{evidence.hitTest=await win.webContents.executeJavaScript('window.bluefish && window.bluefish.hitTest ? window.bluefish.hitTest(innerWidth/2, innerHeight*0.4) : null');}catch(e){evidence.hitTest={error:e.message};}
        evidence.alwaysOnTop=win.isAlwaysOnTop();evidence.tray=!tray.isDestroyed();
        const wa=screen.getPrimaryDisplay().workArea;
        showMenuAt({x:Math.round(wa.x+wa.width*.5),y:Math.round(wa.y+wa.height*.25)});
        await sleep(600);evidence.menuBounds=menuWin.getBounds();await shot(menuWin.webContents,'smoke-menu.png');
        hideMenu();
        openConsole();await sleep(1500);evidence.consoleBounds=consoleWin.getBounds();await shot(consoleWin.webContents,'smoke-console.png');
      }catch(e){evidence.error=String(e&&e.stack||e);console.error(e);}
      try{fs.writeFileSync(path.join(folder,'desktop-complete-smoke.json'),JSON.stringify(evidence,null,2));}catch(e){console.error(e);}
      app.quit();
    })();
  }
}).catch(e=>{console.error(e);app.quit();});
app.on('will-quit',()=>{clearInterval(timer);clearInterval(topTimer);clearTimeout(saveTimer);globalShortcut.unregisterAll();tray?.destroy();server?.close();});
app.on('window-all-closed',()=>app.quit());
}
