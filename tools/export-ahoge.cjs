// Export the code-defined vector strand on the existing fixed 2048 grid.
const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path');const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(root,'.test-output/vector-export-profile'));
app.whenReady().then(async()=>{let win;try{
 const {ahogeSVG,ahogeBounds}=await import(pathToFileURL(path.join(root,'src/ahoge.mjs'))),svg=ahogeSVG();
 fs.mkdirSync(path.join(root,'assets/vector'),{recursive:true});fs.writeFileSync(path.join(root,'assets/vector/ahoge.svg'),svg);
 win=new BrowserWindow({show:false,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true}});await win.loadURL('data:text/html,<html></html>');
 const image=await win.webContents.executeJavaScript(`(async()=>{const img=new Image();img.src=${JSON.stringify('data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'))};await img.decode();const c=document.createElement('canvas');c.width=c.height=2048;c.getContext('2d').drawImage(img,0,0);return c.toDataURL('image/png').split(',')[1];})()`);
 fs.writeFileSync(path.join(root,'assets/layers/ahoge.png'),Buffer.from(image,'base64'));
 const file=path.join(root,'assets/rig.json'),rig=JSON.parse(fs.readFileSync(file,'utf8')),layer=rig.layers.find(l=>l.name==='ahoge');layer.box=ahogeBounds();layer.vectorSource='assets/vector/ahoge.svg';rig.completion.ahoge='Code-drawn degree-two quadratic vector curl with tangent-continuous boundaries; fixed original root; matching SVG and PNG export.';fs.writeFileSync(file,JSON.stringify(rig,null,2)+'\n');
 console.log(JSON.stringify({exported:true,box:layer.box,pngBytes:Buffer.from(image,'base64').length}));
 }catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}});
