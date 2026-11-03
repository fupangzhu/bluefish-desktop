const {app,BrowserWindow,ipcMain,screen,Menu,globalShortcut,Tray,nativeImage,shell}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const {createDrag,dragBounds}=require('./drag.cjs');
app.setName('Bluefish Complete');
app.setPath('userData',path.join(app.getPath('appData'),'bluefish-complete'));
let win,server,timer,drag=null,ignored=false,tray,saveTimer,paused=false,follow=true;
if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>win?.showInactive());
app.whenReady().then(async()=>{
  const {createServer}=await import('../server.mjs');server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port;
  const stateFile=path.join(app.getPath('userData'),'window.json');let size=360,position=null;
  try{const p=JSON.parse(fs.readFileSync(stateFile,'utf8'));if([280,360,460].includes(p.size))size=p.size;if(Number.isFinite(p.x)&&Number.isFinite(p.y)&&screen.getAllDisplays().some(d=>p.x>=d.workArea.x&&p.y>=d.workArea.y&&p.x+size<=d.workArea.x+d.workArea.width&&p.y+size<=d.workArea.y+d.workArea.height))position={x:Math.round(p.x),y:Math.round(p.y)};}catch{}
  function corner(){const a=screen.getPrimaryDisplay().workArea;return {x:a.x+a.width-size-20,y:a.y+a.height-size-12};}
  win=new BrowserWindow({...position||corner(),width:size,height:size,minWidth:size,minHeight:size,maxWidth:size,maxHeight:size,title:'蓝色肥鱼 · 完整头部',frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,resizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(base+'/'))e.preventDefault();});
  await win.loadURL(base+'/?overlay');win.showInactive();
  const owned=e=>win&&!win.isDestroyed()&&e.sender===win.webContents;
  const action=name=>win?.webContents.send('action',name);
  function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(win&&!win.isDestroyed()){const {x,y}=win.getBounds();try{fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile,JSON.stringify({x,y,size}));}catch{}}},180);}
  function resetPosition(){drag=null;win.setBounds({...corner(),width:size,height:size});win.showInactive();action('reset');save();}
  function scale(next){if(![280,360,460].includes(next))return;size=next;win.setMinimumSize(1,1);win.setMaximumSize(next,next);win.setBounds({...corner(),width:next,height:next});win.setMinimumSize(next,next);resetPosition();}
  function toggleVisibility(){drag=null;if(win.isVisible())win.hide();else win.showInactive();}
  const menu=()=>Menu.buildFromTemplate([
    {id:'show',label:win.isVisible()?'隐藏角色':'显示角色',click:toggleVisibility},
    {label:'打开动作工作台',click:()=>shell.openExternal(base)},
    {type:'separator'},
    {label:'眨眨眼',click:()=>action('blink')},{label:'单眼眨眼',click:()=>action('wink')},{label:'点点头',click:()=>action('nod')},{label:'摇摇头',click:()=>action('shakehead')},{label:'开心一下',click:()=>action('happy')},
    {type:'separator'},
    {label:'跟随鼠标',type:'checkbox',checked:follow,click:()=>{follow=!follow;action('toggle-follow');}},
    {label:'自然待机',type:'checkbox',checked:!paused,click:()=>{paused=!paused;action('toggle-idle');}},
    {label:'角色大小',submenu:[280,360,460].map(n=>({label:n+' px',type:'radio',checked:size===n,click:()=>scale(n)}))},
    {label:'回到右下角',click:resetPosition},{type:'separator'},{label:'退出蓝色肥鱼',click:()=>app.quit()}
  ]);
  ipcMain.on('interactive',(e,hit)=>{if(!owned(e)||drag)return;ignored=!hit;win.setIgnoreMouseEvents(ignored,{forward:true});});
  ipcMain.on('drag',(e,on)=>{if(!owned(e))return;if(on){drag=createDrag(screen.getCursorScreenPoint(),win.getBounds());win.setIgnoreMouseEvents(false);}else drag=null;});
  ipcMain.on('menu',e=>{if(owned(e)){drag=null;menu().popup({window:win});}});
  const icon=nativeImage.createFromPath(path.join(__dirname,'../assets/master.png')).resize({width:24,height:24});
  tray=new Tray(icon);tray.setToolTip('蓝色肥鱼 · 右键查看动作和设置');tray.setContextMenu(menu());tray.on('click',toggleVisibility);tray.on('right-click',()=>tray.setContextMenu(menu()));
  timer=setInterval(()=>{if(!win||win.isDestroyed())return;const p=screen.getCursorScreenPoint();if(drag){const next=dragBounds(drag,p,win.getBounds(),size);if(next)win.setBounds(next);}const r=win.getContentBounds(),area=screen.getDisplayMatching(r).workArea;
    if(win.isVisible())win.webContents.send('pointer',{x:p.x-r.x,y:p.y-r.y,gx:Math.max(-1,Math.min(1,(p.x-r.x-r.width*.5)/Math.max(200,area.width*.45))),gy:Math.max(-1,Math.min(1,(p.y-r.y-r.height*.5)/Math.max(200,area.height*.45)))});
  },33);
  win.on('move',save);screen.on('display-removed',resetPosition);
  globalShortcut.register('CommandOrControl+Shift+F10',toggleVisibility);
  globalShortcut.register('CommandOrControl+Shift+F11',resetPosition);
  win.on('closed',()=>{win=null;app.quit();});
  if(process.env.BLUEFISH_SMOKE==='1'){
    setTimeout(async()=>{try{
      const evidence=await win.webContents.executeJavaScript(`({ready:!!window.bluefish,rigVersion:window.bluefish?.rig.version,layers:window.bluefish?.rig.layers.length,pose:window.bluefish?.motion.current,pointer:window.bluefish?.pointer,transparentHit:window.bluefish?.renderer.hitTest(8,8),faceHit:window.bluefish?.renderer.hitTest(innerWidth*.5,innerHeight*.7),background:getComputedStyle(document.body).backgroundColor,stats:window.bluefish?.renderer.stats})`);
      await win.webContents.executeJavaScript('window.pet.setInteractive(false)');await new Promise(r=>setTimeout(r,80));evidence.clickThroughIpc=ignored;
      await win.webContents.executeJavaScript('window.pet.drag(true)');await new Promise(r=>setTimeout(r,50));evidence.dragStarted=!!drag;
      await win.webContents.executeJavaScript('window.pet.drag(false)');await new Promise(r=>setTimeout(r,50));evidence.dragReleased=!drag;
      scale(280);evidence.smallSize=win.getContentSize();scale(460);evidence.largeSize=win.getContentSize();scale(360);
      Object.assign(evidence,{bounds:win.getBounds(),contentBounds:win.getContentBounds(),alwaysOnTop:win.isAlwaysOnTop(),resizable:win.isResizable(),hasShadow:win.hasShadow(),tray:!tray.isDestroyed()});
      const folder=process.env.BLUEFISH_SMOKE_DIR||path.join(__dirname,'..');fs.writeFileSync(path.join(folder,'desktop-complete-smoke.json'),JSON.stringify(evidence,null,2));const img=await win.webContents.capturePage();fs.writeFileSync(path.join(folder,'desktop-complete-smoke.png'),img.toPNG());
    }catch(e){console.error(e);}app.quit();},5000);
  }
}).catch(e=>{console.error(e);app.quit();});
app.on('will-quit',()=>{clearInterval(timer);clearTimeout(saveTimer);globalShortcut.unregisterAll();tray?.destroy();server?.close();});
app.on('window-all-closed',()=>app.quit());
}
