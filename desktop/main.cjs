const {app,BrowserWindow,ipcMain,screen,Menu,globalShortcut,Tray,nativeImage}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const {createDrag,dragBounds}=require('./drag.cjs');
const {MIN_SIZE,MAX_SIZE,normalizeSize,dimensions,place,loadSettings}=require('./layout.cjs');
app.setName('Bluefish Complete');app.setPath('userData',path.join(app.getPath('appData'),'bluefish-complete'));
let win,editor,server,timer,drag=null,ignored=false,tray,saveTimer,paused=false,follow=true;
if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>win?.showInactive());
app.whenReady().then(async()=>{
 const {createServer}=await import('../server.mjs');server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+server.address().port,stateFile=path.join(app.getPath('userData'),'window.json');
 let saved={};try{saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{}
 const settings=loadSettings(saved),display=()=>screen.getAllDisplays().find(d=>d.id===settings.displayId)||screen.getPrimaryDisplay();
 const rect=()=>{const d=display();settings.displayId=d.id;return place(d.workArea,settings.size,settings.docked,settings.x,settings.y);};
 const publicSettings=()=>({...dimensions(settings.size,settings.docked),size:settings.size,docked:settings.docked,min:MIN_SIZE,max:MAX_SIZE});
 function broadcast(){for(const w of [win,editor])if(w&&!w.isDestroyed())w.webContents.send('settings',publicSettings());if(tray&&!tray.isDestroyed())tray.setContextMenu(menu());}
 function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile,JSON.stringify(settings));}catch{}},180);}
 function applyLayout(resize=false){const p=rect();settings.x=p.x;settings.y=p.y;const bounds={x:p.x,y:p.y,width:p.width,height:p.height};if(resize){win.setMinimumSize(1,1);win.setMaximumSize(p.width,p.height);win.setBounds(bounds);win.setMinimumSize(p.width,p.height);}else{const current=win.getBounds();if(current.x!==p.x||current.y!==p.y||Math.abs(current.width-p.width)>1||Math.abs(current.height-p.height)>1)win.setBounds(bounds);}save();}
 function configure(patch){if(patch&&typeof patch==='object'){if(patch.size!==undefined)settings.size=normalizeSize(patch.size,settings.size);if(typeof patch.docked==='boolean')settings.docked=patch.docked;drag=null;applyLayout(true);broadcast();}return publicSettings();}
 function action(name){win?.webContents.send('action',name);}
 function resetPosition(){drag=null;settings.x=null;settings.y=null;settings.displayId=screen.getPrimaryDisplay().id;applyLayout(true);win.showInactive();action('reset');broadcast();}
 function toggleVisibility(){drag=null;if(win.isVisible())win.hide();else win.showInactive();}
 const webPreferences={preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true};
 const p=rect();settings.x=p.x;settings.y=p.y;
 win=new BrowserWindow({x:p.x,y:p.y,width:p.width,height:p.height,minWidth:p.width,minHeight:p.height,maxWidth:p.width,maxHeight:p.height,title:'蓝色肥鱼 · 任务栏桌宠',frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,resizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,show:false,webPreferences});
 function guard(w){w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(base+'/'))e.preventDefault();});}
 guard(win);
 function openEditor(){if(editor&&!editor.isDestroyed()){editor.show();editor.focus();return;}editor=new BrowserWindow({width:1200,height:1000,minWidth:820,minHeight:640,title:'蓝色肥鱼 · 编辑器',backgroundColor:'#f7f8fa',webPreferences});guard(editor);editor.loadURL(base+'/?editor');editor.on('closed',()=>editor=null);}
 const owned=e=>[win,editor].some(w=>w&&!w.isDestroyed()&&e.sender===w.webContents),avatar=e=>win&&!win.isDestroyed()&&e.sender===win.webContents;
 ipcMain.handle('settings:get',e=>owned(e)?publicSettings():null);
 ipcMain.handle('settings:set',(e,patch)=>owned(e)?configure(patch):null);
 ipcMain.on('resize-step',(e,step)=>{if(avatar(e)&&Number.isFinite(step))configure({size:settings.size+Math.sign(step)*8});});
 ipcMain.on('interactive',(e,hit)=>{if(!avatar(e)||drag)return;ignored=!hit;win.setIgnoreMouseEvents(ignored,{forward:true});});
 ipcMain.on('drag',(e,on)=>{if(!avatar(e))return;if(on){drag=createDrag(screen.getCursorScreenPoint(),win.getBounds());win.setIgnoreMouseEvents(false);}else drag=null;});
 ipcMain.on('menu',e=>{if(avatar(e)){drag=null;menu().popup({window:win});}});
 function menu(){return Menu.buildFromTemplate([
  {label:win.isVisible()?'隐藏角色':'显示角色',click:toggleVisibility},{label:'调节大小 / 打开编辑器',click:openEditor},
  {label:'吸附到任务栏',type:'checkbox',checked:settings.docked,click:item=>configure({docked:item.checked})},
  {label:'角色大小',submenu:[100,140,200,280,360].map(n=>({label:n+' px',type:'radio',checked:settings.size===n,click:()=>configure({size:n})}))},
  {type:'separator'},...['blink','wink','nod','shakehead','happy'].map((name,i)=>({label:['眨眨眼','单眼眨眼','点点头','摇摇头','开心一下'][i],click:()=>action(name)})),
  {type:'separator'},{label:'跟随鼠标',type:'checkbox',checked:follow,click:()=>{follow=!follow;action('toggle-follow');}},{label:'自然待机',type:'checkbox',checked:!paused,click:()=>{paused=!paused;action('toggle-idle');}},
  {label:'回到右下角',click:resetPosition},{type:'separator'},{label:'退出蓝色肥鱼',click:()=>app.quit()}
 ]);}
 tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'../assets/master.png')).resize({width:24,height:24}));tray.setToolTip('蓝色肥鱼 · 任务栏桌宠');tray.setContextMenu(menu());tray.on('click',toggleVisibility);tray.on('right-click',()=>tray.setContextMenu(menu()));
 await win.loadURL(base+'/?overlay');await win.webContents.setVisualZoomLevelLimits(1,1);applyLayout(true);win.showInactive();
 timer=setInterval(()=>{if(!win||win.isDestroyed())return;const point=screen.getCursorScreenPoint();
  if(drag){const current=win.getBounds(),d=dimensions(settings.size,settings.docked),next=dragBounds(drag,point,current,{width:d.width,height:d.height});if(next){if(settings.docked){settings.displayId=screen.getDisplayNearestPoint(point).id;settings.x=next.x;}else{settings.x=next.x;settings.y=next.y;}applyLayout();}}
  const r=win.getContentBounds(),area=screen.getDisplayMatching(r).workArea;if(win.isVisible())win.webContents.send('pointer',{x:point.x-r.x,y:point.y-r.y,gx:Math.max(-1,Math.min(1,(point.x-r.x-r.width*.5)/Math.max(200,area.width*.45))),gy:Math.max(-1,Math.min(1,(point.y-r.y-settings.size*.5)/Math.max(200,area.height*.45)))});
 },33);
 screen.on('display-removed',resetPosition);screen.on('display-metrics-changed',()=>{if(settings.docked){applyLayout(true);broadcast();}});
 globalShortcut.register('CommandOrControl+Shift+F10',toggleVisibility);globalShortcut.register('CommandOrControl+Shift+F11',resetPosition);
 win.on('closed',()=>{win=null;app.quit();});
 if(process.env.BLUEFISH_SMOKE==='1'){
  setTimeout(async()=>{try{
   const evidence=await win.webContents.executeJavaScript(`({ready:!!window.bluefish,settings:window.bluefish?.settings,pointer:window.bluefish?.pointer,hands:document.querySelectorAll('.hand').length,background:getComputedStyle(document.body).backgroundColor})`);
   evidence.sizes=[];for(const size of [80,113,200,333,640,200]){configure({size});await new Promise(r=>setTimeout(r,80));const b=win.getContentBounds(),d=dimensions(size,true);evidence.sizes.push({requested:size,width:b.width,height:b.height,taskbarDelta:b.y+d.edge-(display().workArea.y+display().workArea.height)});}
   openEditor();for(let i=0;i<80;i++){if(await editor.webContents.executeJavaScript('!!window.bluefish?.settings').catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
   evidence.editorReady=await editor.webContents.executeJavaScript('!!window.bluefish?.settings');await editor.webContents.executeJavaScript('window.pet.updateSettings({size:121})');await new Promise(r=>setTimeout(r,100));evidence.editorSetSize=win.getContentSize()[0];configure({size:200});
   evidence.bounds=win.getContentBounds();evidence.alwaysOnTop=win.isAlwaysOnTop();const folder=process.env.BLUEFISH_SMOKE_DIR||app.getPath('userData');fs.writeFileSync(path.join(folder,'taskbar-smoke.json'),JSON.stringify(evidence,null,2));fs.writeFileSync(path.join(folder,'taskbar-smoke.png'),(await win.webContents.capturePage()).toPNG());
  }catch(e){console.error(e);}app.quit();},3000);
 }
}).catch(e=>{console.error(e);app.quit();});
app.on('will-quit',()=>{clearInterval(timer);clearTimeout(saveTimer);globalShortcut.unregisterAll();tray?.destroy();server?.close();});app.on('window-all-closed',()=>app.quit());
}
