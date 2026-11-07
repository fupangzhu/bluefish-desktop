const {app,BrowserWindow,ipcMain,screen,globalShortcut,Tray,nativeImage,safeStorage}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const {createDrag,dragBounds}=require('./drag.cjs');
const dock=require('./dock.cjs');
const {createBrainHost}=require('./brain.cjs');
const {createSiteHost,SITES}=require('./sites.cjs');
const {createDeskTools}=require('./tools.cjs');
app.setName('Bluefish Complete');
app.setAppUserModelId('com.fupangzhu.bluefish');
const APP_ICON=path.join(__dirname,'../assets/icon.ico');
// BLUEFISH_USER_DATA lets the Electron regression tests run against a throwaway profile.
app.setPath('userData',process.env.BLUEFISH_USER_DATA||path.join(app.getPath('appData'),'bluefish-complete'));
const MENU_W=280,BUBBLE_W=340,BUBBLE_PEEK_MS=12000,BUBBLE_IDLE_MS=45000;
const COMMANDS=new Set(['toggle-visible','quit','close-menu','chat']);
// Gestures the brain may ask the pet for; anything else is dropped.
const PET_ACTIONS=new Set(['nod','shakehead','happy','wink','blink','dip','ear']);
const SMOKE=process.env.BLUEFISH_SMOKE==='1';
const alive=w=>!!w&&!w.isDestroyed();
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
let win,menuWin,bubbleWin,brainHost,siteHost,server,timer,topTimer,drag=null,tray,saveTimer;
const siteStatusLog=[];
let bubbleHeight=120,bubbleMode=null,bubbleHideTimer=null,bubbleActiveAt=0;
// The smoke test drives synthetic input events, so it also stands in for the cursor they imply.
let smokeCursor=null;
const cursorPoint=()=>SMOKE&&smokeCursor?{...smokeCursor}:screen.getCursorScreenPoint();
let lastSet=null,menuAnchor={x:0,y:0},menuShownAt=0,menuHeight=400;
// Main owns the settings; every change is broadcast to pet and menu.
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
    if(Number.isFinite(p.x)&&Number.isFinite(p.y))saved={x:Math.round(p.x),y:Math.round(p.y),layoutVersion:p.layoutVersion||1};
  }catch{}

  // ---- geometry -------------------------------------------------------------------
  function homeBounds(){
    const d=screen.getPrimaryDisplay(),a=d.workArea,cx=dock.homeCenterX(a);
    return state.docked?dock.dockedBounds(a,d.bounds,state.size,cx):dock.freeBounds(a,state.size,{x:cx,y:a.y+a.height-12-state.size/2});
  }
  function initialBounds(){
    if(!saved)return homeBounds();
    const displays=screen.getAllDisplays(),L=dock.layout(state.size,state.docked),legacy=saved.layoutVersion<2;
    const oldW=state.docked?Math.round(state.size*1.3):state.size,oldH=state.docked?Math.round(state.size*.7)+Math.round(state.size*.05):state.size;
    const center={x:saved.x+(legacy?oldW:L.width)/2,y:saved.y+(legacy?oldH:L.height)/2};
    const d=displays.find(d=>center.x>=d.bounds.x&&center.x<=d.bounds.x+d.bounds.width&&center.y>=d.bounds.y&&center.y<=d.bounds.y+d.bounds.height);
    if(!d)return homeBounds();
    return state.docked?dock.dockedBounds(d.workArea,d.bounds,state.size,center.x):dock.freeBounds(d.workArea,state.size,center);
  }
  const start=initialBounds();
  lastSet={...start};
  win=new BrowserWindow({...start,minWidth:start.width,minHeight:start.height,maxWidth:start.width,maxHeight:start.height,title:'蓝色肥鱼',icon:APP_ICON,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,resizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.on('show',()=>{if(alive(win))win.webContents.setBackgroundThrottling(false);});
  win.on('hide',()=>{if(alive(win))win.webContents.setBackgroundThrottling(true);});

  function save(){
    if(SMOKE)return;
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      if(!alive(win))return;
      const b=lastSet||win.getBounds();
      try{fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile,JSON.stringify({layoutVersion:2,x:b.x,y:b.y,size:state.size,docked:state.docked,follow:state.follow,idle:state.idle}));}catch{}
    },180);
  }
  function broadcast(){
    const s=snapshot();
    for(const w of [win,menuWin])if(alive(w))w.webContents.send('state',s);
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
      b=dock.freeBounds(a,state.size,{x:cx,y:fromDocked?a.y+a.height-12-state.size/2:cy});
    }
    updateTop();applyBounds(b);
    if(drag){const active=drag.active;drag=createDrag(cursorPoint(),lastSet,{lockY:state.docked});drag.active=active;}
  }

  // ---- state ----------------------------------------------------------------------
  function applyPatch(patch){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))return;
    const before=JSON.stringify(state),wasDocked=state.docked,oldSize=state.size;
    if(typeof patch.size==='number'&&Number.isFinite(patch.size))state.size=dock.clampSize(patch.size);
    for(const k of ['docked','follow','idle','reduced'])if(typeof patch[k]==='boolean')state[k]=patch[k];
    if(JSON.stringify(state)===before)return;
    if(state.size!==oldSize||state.docked!==wasDocked)relayout(wasDocked&&!state.docked);
    broadcast();save();
  }
  const sendPet=(channel,payload)=>{if(alive(win))win.webContents.send(channel,payload);};
  function toggleVisibility(){
    drag=null;hideMenu();
    if(win.isVisible()){win.hide();hideBubble();}else win.showInactive();
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
    menuWin=new BrowserWindow({width:MENU_W,height:menuHeight,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,show:false,title:'蓝色肥鱼菜单',webPreferences:{preload:path.join(__dirname,'menu-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
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
  function runCommand(name){
    switch(name){
      case 'toggle-visible':toggleVisibility();break;
      case 'quit':app.quit();break;
      case 'close-menu':hideMenu();break;
      case 'chat':hideMenu();openChat();break;
    }
  }

  // ---- chat bubble -----------------------------------------------------------------------------
  // Where the top of her head is on screen (the bubble's tail points there).
  function bubbleBounds(){
    const b=lastSet||win.getBounds(),s=state.size,cx=b.x+b.width/2;
    // Measured from the render: the ahoge tip sits ~.45×size below the window top, docked or free.
    const head=b.y+Math.round(s*.43);
    const a=screen.getDisplayNearestPoint({x:Math.round(cx),y:head}).workArea;
    return {x:Math.round(clamp(cx-BUBBLE_W/2,a.x,a.x+a.width-BUBBLE_W)),y:Math.round(clamp(head-bubbleHeight,a.y,a.y+a.height-bubbleHeight)),width:BUBBLE_W,height:bubbleHeight};
  }
  function placeBubble(){
    if(!alive(bubbleWin))return;
    const n=bubbleBounds(),c=bubbleWin.getBounds();
    if(n.x!==c.x||n.y!==c.y||n.width!==c.width||n.height!==c.height)bubbleWin.setBounds(n);
  }
  function createBubble(){
    bubbleWin=new BrowserWindow({width:BUBBLE_W,height:bubbleHeight,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,show:false,title:'小鱼',webPreferences:{preload:path.join(__dirname,'bubble-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    bubbleWin.setAlwaysOnTop(true,'screen-saver');
    harden(bubbleWin.webContents);
    bubbleWin.on('blur',()=>{if(bubbleMode==='chat')armBubbleHide(BUBBLE_IDLE_MS);});
    bubbleWin.on('focus',()=>clearTimeout(bubbleHideTimer));
    bubbleWin.on('closed',()=>{bubbleWin=null;bubbleMode=null;});
    return bubbleWin.loadURL(base+'/bubble.html').catch(()=>{});
  }
  function armBubbleHide(ms){clearTimeout(bubbleHideTimer);bubbleHideTimer=setTimeout(hideBubble,ms);}
  function hideBubble(){clearTimeout(bubbleHideTimer);bubbleMode=null;if(alive(bubbleWin)&&bubbleWin.isVisible())bubbleWin.hide();}
  // chat: input box, focused. peek: just her lines, never steals focus, fades on its own.
  async function showBubble(mode,{settings=false}={}){
    if(!alive(bubbleWin))await createBubble();
    if(!win.isVisible())win.showInactive();
    hideMenu();
    const upgrade=mode==='chat'||bubbleMode!=='chat';
    if(upgrade){bubbleMode=mode;bubbleWin.webContents.send('bubble:mode',{mode,settings});}
    placeBubble();
    if(bubbleMode==='chat'){clearTimeout(bubbleHideTimer);bubbleWin.show();bubbleWin.moveTop();bubbleWin.focus();}
    else{bubbleWin.showInactive();bubbleWin.moveTop();armBubbleHide(BUBBLE_PEEK_MS);}
    bubbleActiveAt=Date.now();
  }
  function openChat(){showBubble('chat');}
  function toggleChat(){if(bubbleMode==='chat'&&alive(bubbleWin)&&bubbleWin.isVisible())hideBubble();else openChat();}
  const sendBubble=(channel,payload)=>{if(alive(bubbleWin))bubbleWin.webContents.send(channel,payload);};
  // Every channel shows in the bubble; a line that did not come from the bubble carries its channel
  // so the desktop owner can tell a WeChat answer from their own conversation.
  const brainOut={
    say(text,channel){
      if(channel&&channel!=='desktop')sendPet('action','ear');
      showBubble('peek').then(()=>sendBubble('bubble:line',{who:'her',text,channel:channel||'desktop'}));
    },
    act(action,channel){if(PET_ACTIONS.has(action))sendPet('action',action);},
    typing(on,channel){sendBubble('bubble:typing',!!on);},
    notice(text,channel,{settings=false}={}){
      if(channel!=='desktop'&&!settings)return;
      showBubble(settings?'chat':'peek',{settings}).then(()=>sendBubble('bubble:line',{who:'notice',text,settings}));
    },
    state(name){if(name==='thinking')sendPet('action','ear');},
    // A message arrived from WeChat: she perks up an ear on the desktop.
    incoming(){sendPet('action','ear');},
    weixinStatus(s){sendBubble('bubble:weixin',s);}
  };

  // ---- IPC (every sender is validated) ------------------------------------------------
  const petOwned=e=>alive(win)&&e.sender===win.webContents;
  const ctlOwned=e=>alive(menuWin)&&e.sender===menuWin.webContents;
  ipcMain.on('interactive',(e,hit)=>{if(!petOwned(e)||drag)return;win.setIgnoreMouseEvents(hit!==true,{forward:true});});
  ipcMain.on('drag',(e,on)=>{
    if(!petOwned(e))return;
    if(on===true){drag=createDrag(cursorPoint(),lastSet||win.getBounds(),{lockY:state.docked});win.setIgnoreMouseEvents(false);}
    else endDrag();
  });
  // Ahoge tow: the renderer simulates the elastic follow and asks for a docked window x.
  ipcMain.on('tow',(e,x)=>{
    if(!petOwned(e)||drag||!state.docked||typeof x!=='number'||!Number.isFinite(x)||!lastSet)return;
    const d=screen.getDisplayMatching(lastSet),L=dock.layout(state.size,true),b=dock.dockedBounds(d.workArea,d.bounds,state.size,x+L.width/2);
    if(b.x!==lastSet.x||b.y!==lastSet.y)applyBounds(b);
  });
  ipcMain.on('menu',e=>{if(petOwned(e))showMenuAt(screen.getCursorScreenPoint());});
  ipcMain.on('zoom',(e,steps)=>{
    if(!petOwned(e)||typeof steps!=='number'||!Number.isFinite(steps))return;
    const n=clamp(Math.trunc(steps),-10,10);
    if(n)applyPatch({size:state.size+n*10});
  });
  ipcMain.handle('ctl:get-state',e=>ctlOwned(e)?snapshot():null);
  ipcMain.on('ctl:set',(e,patch)=>{if(ctlOwned(e))applyPatch(patch);});
  ipcMain.on('ctl:command',(e,name)=>{if(ctlOwned(e)&&COMMANDS.has(name))runCommand(name);});
  ipcMain.on('ctl:fit',(e,height)=>{
    if(!ctlOwned(e)||!alive(menuWin)||e.sender!==menuWin.webContents||typeof height!=='number'||!Number.isFinite(height))return;
    menuHeight=clamp(Math.round(height),80,600);
    if(menuWin.isVisible())placeMenu();
  });
  // chat
  const bubbleOwned=e=>alive(bubbleWin)&&e.sender===bubbleWin.webContents;
  const safely=fn=>async(...a)=>{try{return await fn(...a);}catch(err){return {error:err?.message||String(err)};}};
  ipcMain.on('chat',e=>{if(petOwned(e))toggleChat();});
  ipcMain.on('bubble:send',(e,text)=>{if(!bubbleOwned(e)||typeof text!=='string')return;bubbleActiveAt=Date.now();brainHost?.receive(text.slice(0,2000),'desktop');});
  ipcMain.on('bubble:typing',e=>{if(bubbleOwned(e))brainHost?.typing();});
  ipcMain.on('bubble:close',e=>{if(bubbleOwned(e))hideBubble();});
  ipcMain.on('bubble:fit',(e,height)=>{
    if(!bubbleOwned(e)||typeof height!=='number'||!Number.isFinite(height))return;
    bubbleHeight=clamp(Math.round(height),60,720);placeBubble();
  });
  ipcMain.handle('bubble:settings',e=>bubbleOwned(e)&&brainHost?brainHost.settings():null);
  ipcMain.handle('bubble:save',safely((e,patch)=>bubbleOwned(e)&&brainHost?brainHost.update(patch):null));
  ipcMain.handle('bubble:models',safely((e,patch)=>bubbleOwned(e)&&brainHost?brainHost.models(patch):[]));
  ipcMain.handle('bubble:defaults',safely(e=>bubbleOwned(e)&&brainHost?brainHost.defaults():{persona:''}));
  ipcMain.handle('bubble:weixin-status',e=>bubbleOwned(e)&&brainHost?brainHost.weixinStatus():null);
  ipcMain.handle('bubble:weixin-connect',safely(e=>bubbleOwned(e)&&brainHost?brainHost.weixinConnect():null));
  ipcMain.handle('bubble:weixin-cancel',safely(e=>bubbleOwned(e)&&brainHost?brainHost.weixinCancel():null));
  ipcMain.handle('bubble:weixin-disconnect',safely(e=>bubbleOwned(e)&&brainHost?brainHost.weixinDisconnect():null));
  ipcMain.handle('bubble:history',e=>bubbleOwned(e)&&brainHost?brainHost.history(16).map(x=>({type:x.type,text:x.text,channel:x.channel||'desktop'})):[]);
  // Sites: the login window itself is opened here, the bubble only shows the state.
  ipcMain.handle('bubble:site-status',safely(async(e,key)=>bubbleOwned(e)&&siteHost?siteHost.status(String(key)):null));
  ipcMain.handle('bubble:site-login',safely(async(e,key)=>bubbleOwned(e)&&siteHost?siteHost.login(String(key)):null));
  ipcMain.handle('bubble:site-logout',safely(async(e,key)=>bubbleOwned(e)&&siteHost?siteHost.logout(String(key)):null));

  // ---- dragging -------------------------------------------------------------------------
  function undock(p){
    state.docked=false;
    const d=screen.getDisplayNearestPoint(p),L=dock.layout(state.size,false);
    // Bottom edge slightly above the cursor, centered on the cursor x.
    const b=dock.freeBounds(d.workArea,state.size,{x:p.x,y:p.y-6-state.size/2});
    updateTop();applyBounds(b);
    drag=createDrag(p,b);drag.active=true;
    broadcast();save();
  }
  function endDrag(){
    const was=drag;drag=null;
    if(!was||!was.active||state.docked||!lastSet)return;
    const d=screen.getDisplayMatching(lastSet);
    if(dock.shouldDock(lastSet,d.workArea,state.size)){state.docked=true;relayout();broadcast();save();}
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
    const p=cursorPoint();
    if(drag)dragStep(p);
    const r=win.getContentBounds(),display=screen.getDisplayMatching(r),area=display.workArea;
    let track=null,wall={side:0,gap:0};
    if(state.docked&&lastSet){
      const others=screen.getAllDisplays().filter(d=>d.id!==display.id).map(d=>d.bounds);
      track={x:lastSet.x,...dock.dockRange(area,display.bounds,state.size)};wall=dock.wallInfo(lastSet,display.bounds,state.size,others);
    }
    if(alive(bubbleWin)&&bubbleWin.isVisible())placeBubble();
    if(win.isVisible())win.webContents.send('pointer',{x:p.x-r.x,y:p.y-r.y,sx:p.x,sy:p.y,win:track,wall,innerSide:r.x+r.width*.5<area.x+area.width*.5?1:-1,gx:clamp((p.x-r.x-r.width*.5)/Math.max(200,area.width*.45),-1,1),gy:clamp((p.y-r.y-(state.docked?r.height-Math.round(state.size*.05)-state.size*.2024:r.height*.5))/Math.max(200,area.height*.45),-1,1)});
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
  globalShortcut.register('CommandOrControl+Shift+F9',toggleChat);
  win.on('closed',()=>{win=null;app.quit();});
  createMenu();
  // Her hands: screenshot and read-the-window through the agent-desktop CLI (resolved once).
  const deskBin=path.join(process.env.APPDATA||'', 'npm','node_modules','agent-desktop','bin','agent-desktop-win32-x64.exe');
  let deskTools=null;
  try{deskTools=await createDeskTools({bin:deskBin,shotDir:path.join(app.getPath('pictures'),'小鱼截图'),log:console.warn});}
  catch(e){console.error('desk tools init failed',e);}
  try{brainHost=await createBrainHost({dir:path.join(app.getPath('userData'),'brain'),safeStorage,out:brainOut,weixinBase:SMOKE?process.env.BLUEFISH_WEIXIN_BASE:null,tools:deskTools}).init();}
  catch(e){console.error('brain init failed',e);}
  // Scan-code logins (B站, ...) keep their own persistent partitions; the smoke points them at a
  // local page instead of the real site.
  const siteBase=SMOKE?process.env.BLUEFISH_SITE_BASE:null;
  const siteDefs=Object.fromEntries(Object.entries(SITES).map(([k,v])=>[k,siteBase?{...v,login:siteBase+'/site-login',home:siteBase+'/'}:v]));
  siteHost=createSiteHost({sites:siteDefs,out:(key,st)=>{siteStatusLog.push({key,state:st.state});sendBubble('bubble:site',{key,...st});},log:console.warn});
  createBubble();

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
        for(let i=0;i<100&&!ready;i++){try{ready=await win.webContents.executeJavaScript('!!window.bluefish?.renderer');}catch{}if(!ready)await sleep(100);}
        evidence.ready=ready;
        await sleep(600);
        evidence.state=snapshot();
        await geometry('docked150',{size:150,docked:true});
        await geometry('docked460',{size:460,docked:true});
        await geometry('free240',{size:240,docked:false});
        await sleep(300);await shot(win.webContents,'smoke-pet-free.png');
        await geometry('docked240',{size:240,docked:true});
        await sleep(300);await shot(win.webContents,'smoke-pet-docked.png');
        try{evidence.hitTest=await win.webContents.executeJavaScript('(()=>{const b=window.bluefish,p=b.position(),s=b.state.size;return {head:b.hitTest(p.left+s*.5,p.top+s*.46),gutter:b.hitTest(1,1)};})()');}catch(e){evidence.hitTest={error:e.message};}
        evidence.alwaysOnTop=win.isAlwaysOnTop();evidence.tray=!tray.isDestroyed();
        evidence.backgroundThrottlingVisible=win.webContents.getBackgroundThrottling();win.hide();await sleep(100);evidence.backgroundThrottlingHidden=win.webContents.getBackgroundThrottling();win.showInactive();
        const wa=screen.getPrimaryDisplay().workArea;
        showMenuAt({x:Math.round(wa.x+wa.width*.5),y:Math.round(wa.y+wa.height*.25)});
        await sleep(600);evidence.menuBounds=menuWin.getBounds();await shot(menuWin.webContents,'smoke-menu.png');
        hideMenu();
        evidence.editorStatus=await win.webContents.executeJavaScript('fetch("/").then(r=>r.status)');
        evidence.menuAnimationButtons=await menuWin.webContents.executeJavaScript('document.querySelectorAll("[data-action]").length');
        evidence.menuEditorEntries=await menuWin.webContents.executeJavaScript('document.querySelectorAll("[data-command=open-console]").length');
        // Chat: real input events on the pet, a fake OpenAI-compatible model behind the brain.
        if(process.env.BLUEFISH_SMOKE_CHAT){
          const chat=evidence.chat={};
          // Fill the settings through the bubble UI, exactly as a person would.
          await showBubble('chat');await sleep(400);
          chat.saveUi=await bubbleWin.webContents.executeJavaScript(`(async()=>{
            const $=s=>document.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
            $('#gear').click();await wait(300);
            const set=(id,v)=>{const el=$(id);el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
            set('#baseUrl',${JSON.stringify(process.env.BLUEFISH_SMOKE_CHAT)});set('#apiKey','smoke-key');set('#model','fake-model');
            $('#fetchModels').click();await wait(400);const models=[...document.querySelectorAll('#modelList option')].map(o=>o.value);
            const personaPrefilled=$('#persona').value.length;
            $('#save').click();await wait(400);
            return {models,personaPrefilled,error:$('#settingsError').hidden?'':$('#settingsError').textContent,panelHidden:$('#settings').hidden,notice:[...document.querySelectorAll('.line.notice')].map(e=>e.textContent)};
          })()`);
          hideBubble();await sleep(200);
          chat.settings=brainHost.settings();delete chat.settings.usage;
          const head=await win.webContents.executeJavaScript('(()=>{const p=window.bluefish.position(),s=window.bluefish.state.size;return {x:Math.round(p.left+s*.5),y:Math.round(p.top+s*.46)};})()');
          const at=(x,y)=>{const r=win.getContentBounds();smokeCursor={x:r.x+Math.round(x),y:r.y+Math.round(y)};};
          const input=(type,x,y,extra={})=>{at(x,y);win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),globalX:smokeCursor.x,globalY:smokeCursor.y,...extra});};
          const press=async(x,y,{up=true,move=null}={})=>{
            input('mouseMove',x,y);await sleep(80);
            input('mouseDown',x,y,{button:'left',clickCount:1});
            if(move){for(let i=1;i<=6;i++){await sleep(16);input('mouseMove',x+move.x*i/6,y+move.y*i/6,{button:'left'});}}
            await sleep(60);if(up)input('mouseUp',x+(move?.x||0),y+(move?.y||0),{button:'left',clickCount:1});
          };
          const bubbleShown=()=>alive(bubbleWin)&&bubbleWin.isVisible()&&bubbleMode==='chat';
          await sleep(2500);
          chat.before=await win.webContents.executeJavaScript('(()=>{const b=window.bluefish,m=b.motion,a=m.attention.current;return {hit:b.hitTest('+head.x+','+head.y+'),sleeping:a.sleeping,woke:a.woke,wake:m.wake.active,bonk:m.touch.bonking,dip:m.touch.dip.active,active:!!b.touchInput.active};})()');
          await press(head.x,head.y);await sleep(150);chat.openBeforeConfirm=bubbleShown();
          chat.firstClick=await win.webContents.executeJavaScript('window.bluefish.lastClick??null');
          await sleep(500);chat.openAfterClick=bubbleShown();
          await sleep(200);await shot(bubbleWin.webContents,'smoke-bubble-open.png');
          chat.bubbleBounds=bubbleWin.getBounds();chat.petBounds={...lastSet};
          await bubbleWin.webContents.executeJavaScript('(()=>{const i=document.querySelector("#text");i.value="在吗";document.querySelector("#composer").requestSubmit();})()');
          for(let i=0;i<80;i++){await sleep(100);const n=await bubbleWin.webContents.executeJavaScript('document.querySelectorAll(".line.her").length');if(n>=2)break;}
          await sleep(300);
          chat.lines=await bubbleWin.webContents.executeJavaScript('[...document.querySelectorAll(".line")].map(e=>e.className.split(" ")[1]+":"+e.textContent)');
          await shot(bubbleWin.webContents,'smoke-bubble-reply.png');await shot(win.webContents,'smoke-pet-chat.png');
          chat.replyBounds={bubble:bubbleWin.getBounds(),pet:win.getBounds()};
          hideBubble();await sleep(1200);
          await press(head.x,head.y);await sleep(130);await press(head.x,head.y);await sleep(900);
          chat.openAfterDoubleTap=bubbleShown();hideBubble();await sleep(2500);
          await press(head.x,head.y,{move:{x:60,y:0}});await sleep(900);
          chat.openAfterDrag=bubbleShown();hideBubble();
          chat.events=brainHost.history(10).map(e=>e.type+':'+e.text);
          // WeChat: connect through the settings, scan (fake), then answer a message from WeChat.
          if(process.env.BLUEFISH_WEIXIN_BASE){
            const w=chat.weixin={};
            await showBubble('chat');await sleep(300);
            await bubbleWin.webContents.executeJavaScript('(()=>{if(document.querySelector("#settings").hidden)document.querySelector("#gear").click();})()');await sleep(400);
            await bubbleWin.webContents.executeJavaScript('document.querySelector("#wxButton").click()');
            for(let i=0;i<40;i++){await sleep(100);if(await bubbleWin.webContents.executeJavaScript('!document.querySelector("#qr").hidden'))break;}
            w.qrShown=await bubbleWin.webContents.executeJavaScript('!document.querySelector("#qr").hidden&&!!document.querySelector("#qr svg path")');
            w.qrStatus=await bubbleWin.webContents.executeJavaScript('document.querySelector("#wxStatus").textContent');
            await shot(bubbleWin.webContents,'smoke-weixin-qr.png');
            for(let i=0;i<150&&brainHost.weixinStatus().state!=='connected';i++)await sleep(100);
            w.connected=brainHost.weixinStatus().state==='connected';
            for(let i=0;i<150;i++){await sleep(100);if(brainHost.history(20).filter(e=>e.channel==='weixin'&&e.type==='said').length>=2)break;}
            await sleep(300);
            w.events=brainHost.history(20).filter(e=>e.channel==='weixin').map(e=>e.type+':weixin:'+e.text);
            w.statusText=await bubbleWin.webContents.executeJavaScript('document.querySelector("#wxStatus").textContent');
            // The desktop bubble is open, so her WeChat lines should have landed there with a tag.
            w.bubbleLines=await bubbleWin.webContents.executeJavaScript('[...document.querySelectorAll(".line.her")].map(e=>e.textContent)');
            await shot(bubbleWin.webContents,'smoke-weixin-connected.png');
            const raw=fs.readFileSync(path.join(app.getPath('userData'),'brain','weixin.json'),'utf8');
            w.tokenOnDisk=raw.includes('BOT-TOKEN');w.savedKeys=Object.keys(JSON.parse(raw)).sort();
            hideBubble();
          }
          // Sites: the scan-code login opens the site's own page; a local one sets the cookie here.
          if(process.env.BLUEFISH_SITE_BASE){
            const s=chat.site={};
            const siteText=()=>bubbleWin.webContents.executeJavaScript('document.querySelector("#siteStatus").textContent');
            await showBubble('chat');await sleep(300);
            await bubbleWin.webContents.executeJavaScript('(()=>{if(document.querySelector("#settings").hidden)document.querySelector("#gear").click();})()');await sleep(300);
            s.before=await siteText();
            await bubbleWin.webContents.executeJavaScript('document.querySelector("#siteButton").click()');
            // Wait for the host's own status event (the sample loop runs once a second), then the label.
            for(let i=0;i<120;i++){await sleep(100);if(siteStatusLog.some(x=>x.state==='connected'))break;}
            for(let i=0;i<40;i++){s.after=await siteText();if(s.after==='已登录')break;await sleep(100);}
            s.state=(await siteHost.status('bilibili')).state;
            s.sent=siteStatusLog.slice();
            await shot(bubbleWin.webContents,'smoke-site-login.png');
            await bubbleWin.webContents.executeJavaScript('document.querySelector("#siteButton").click()');
            for(let i=0;i<80;i++){await sleep(100);if(siteStatusLog.filter(x=>x.state==='off').length>0&&(await siteHost.status('bilibili')).state==='off')break;}
            s.afterLogout=(await siteHost.status('bilibili')).state;
            hideBubble();
          }
        }
      }catch(e){evidence.error=String(e&&e.stack||e);console.error(e);}
      try{fs.writeFileSync(path.join(folder,'desktop-complete-smoke.json'),JSON.stringify(evidence,null,2));}catch(e){console.error(e);}
      app.quit();
    })();
  }
}).catch(e=>{console.error(e);app.quit();});
app.on('will-quit',()=>{brainHost?.stop();siteHost?.dispose();clearTimeout(bubbleHideTimer);clearInterval(timer);clearInterval(topTimer);clearTimeout(saveTimer);globalShortcut.unregisterAll();tray?.destroy();server?.close();});
app.on('window-all-closed',()=>app.quit());
}
