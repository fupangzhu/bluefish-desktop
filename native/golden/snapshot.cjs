// Reference pictures from the real WebGL renderer: fixed poses drawn into a 612 px canvas
// (size 240 at 150%), saved as PNGs for tests/raster.rs to compare against the CPU rasterizer.
// Run: npx electron native/golden/snapshot.cjs <out dir>
const {app,BrowserWindow}=require('electron');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..','..'),out=path.resolve(process.argv[2]||path.join(root,'native','target','golden','snap'));
const types={'.html':'text/html','.mjs':'text/javascript','.json':'application/json','.png':'image/png'};
const POSES=JSON.parse(fs.readFileSync(path.join(__dirname,'poses.json'),'utf8'));
app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const server=http.createServer((req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://x').pathname);
    if(name==='/snap.html'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><body style="margin:0;background:transparent"><canvas id="c" style="width:408px;height:408px"></canvas><script type="module">import {Renderer} from "/src/renderer.mjs";const rig=await (await fetch("/assets/rig.json")).json();window.r=await new Renderer(document.getElementById("c"),rig).init();window.r.padding=.35;window.ready=true;</script>');}
    fs.readFile(path.join(root,name),(err,body)=>{if(err){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream'});res.end(body);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const win=new BrowserWindow({width:408,height:408,show:false,transparent:true,frame:false,webPreferences:{offscreen:false,zoomFactor:1}});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/snap.html`);
  for(let i=0;i<200;i++){if(await win.webContents.executeJavaScript('!!window.ready'))break;await new Promise(r=>setTimeout(r,50));}
  for(const [name,pose] of Object.entries(POSES)){
    // devicePixelRatio is 1 here; size the backing store to 612 px directly.
    const url=await win.webContents.executeJavaScript(`(()=>{const c=document.getElementById('c');Object.defineProperty(window,'devicePixelRatio',{value:1.5,configurable:true});window.r.render(${JSON.stringify(pose)});return c.toDataURL('image/png');})()`);
    fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(url.split(',')[1],'base64'));
  }
  console.log('wrote',Object.keys(POSES).length,'snapshots to',out);
  server.close();app.quit();
});
