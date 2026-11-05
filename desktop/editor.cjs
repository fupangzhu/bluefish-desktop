// Developer-only entry. This file and the editor UI are excluded from Windows release payloads.
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),cache=path.join(root,'.editor-cache');fs.mkdirSync(cache,{recursive:true});app.setPath('userData',cache);app.setName('Bluefish Editor');app.setAppUserModelId('com.fupangzhu.bluefish.editor');let win,server;
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
 app.whenReady().then(async()=>{const {createServer}=await import('../server.mjs');server=createServer({editor:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  win=new BrowserWindow({width:1100,height:800,minWidth:760,minHeight:520,title:'蓝色肥鱼 · 动画编辑器',icon:path.join(root,'assets/icon.ico'),titleBarStyle:'hidden',titleBarOverlay:{color:'#f2f2f2',symbolColor:'#161616',height:44},backgroundColor:'#f2f2f2',show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});win.removeMenu();win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(base+'/'))e.preventDefault();});const params=new URLSearchParams();for(const arg of process.argv){if(arg.startsWith('--preview='))params.set('preview',arg.slice(10));if(arg.startsWith('--at='))params.set('at',arg.slice(5));}await win.loadURL(base+'/?'+params);win.show();win.on('closed',()=>app.quit());
 }).catch(error=>{console.error(error);app.quit();});app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>server?.close());
}
