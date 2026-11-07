// Desktop tools for the chat brain: take a screenshot, or read what a window shows.
// Both go through the agent-desktop CLI (one process per call, hard timeout), so nothing here
// touches the accessibility tree directly. Read-only for now: no clicking, no typing.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {nativeImage}=require('electron');

// Electron's main-process clipboard in this build is the async web API, which refuses a plain
// image; the Windows clipboard through PowerShell is boring but reliable.
function copyImageToClipboard(file,{timeoutMs=8000}={}){
  return new Promise(resolve=>{
    const escaped=String(file).replace(/'/g,"''");
    const script=`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $img=[System.Drawing.Image]::FromFile('${escaped}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()`;
    let child;
    try{
      // No -WindowStyle Hidden: with it PowerShell exits with 0xFFFFFFFF; windowsHide already
      // keeps the console window from flashing.
      child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command',script],{windowsHide:true,stdio:'ignore'});
    }catch{return resolve(false);}
    const timer=setTimeout(()=>{try{child.kill();}catch{}resolve(false);},timeoutMs);
    child.on('error',()=>{clearTimeout(timer);resolve(false);});
    child.on('close',code=>{clearTimeout(timer);resolve(code===0);});
  });
}

const DEFAULT_TIMEOUT_MS=25000;

function run(bin,args,{timeoutMs=DEFAULT_TIMEOUT_MS}={}){
  return new Promise((resolve,reject)=>{
    let child;
    try{child=spawn(bin,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});}catch(e){return reject(Error('启动 agent-desktop 失败：'+e.message));}
    let out='',err='',done=false;
    const finish=(fn,arg)=>{if(done)return;done=true;clearTimeout(timer);fn(arg);};
    const timer=setTimeout(()=>{try{child.kill();}catch{}finish(reject,Error('agent-desktop 超时'));},timeoutMs);
    child.stdout.on('data',c=>out+=c);
    child.stderr.on('data',c=>err+=c);
    child.on('error',e=>finish(reject,Error('启动 agent-desktop 失败：'+e.message)));
    child.on('close',code=>finish(resolve,{code,out,err}));
  });
}

async function createDeskTools({bin=null,shotDir,log=console.warn,timeoutMs=DEFAULT_TIMEOUT_MS}={}){
  const desk=await import(pathToFileURL(path.join(__dirname,'..','src','agent','desk.mjs')).href);
  const available=!!bin&&fs.existsSync(bin);

  async function call(args){
    const {code,out,err}=await run(bin,args,{timeoutMs});
    const envelope=desk.parseEnvelope(out);
    if(envelope?.ok)return envelope.data;
    const why=envelope?.error?.message||err.trim()||`agent-desktop 退出码 ${code}`;
    throw Error(why.slice(0,200));
  }

  async function screenshot({app}={}){
    if(!available)return {text:'这台机器上没找到 agent-desktop，暂时不能截图。'};
    const dir=typeof shotDir==='function'?shotDir():shotDir;
    fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,desk.shotName());
    const data=await call(['screenshot',file,...(app?['--app',String(app)]:[])]);
    const copied=await copyImageToClipboard(file);
    return {path:file,copied,text:desk.shotText({path:file,app,width:data?.width,height:data?.height})+(copied?'':'（剪贴板没写成，直接打开文件吧）')};
  }

  // A screenshot small enough to hand to the vision model (it downscales to ~1300×1300 anyway,
  // so uploading a 3840-wide PNG would only cost bandwidth).
  async function capture({app}={}){
    if(!available)throw Error('这台机器上没找到 agent-desktop');
    const dir=typeof shotDir==='function'?shotDir():shotDir;
    fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,desk.shotName());
    const data=await call(['screenshot',file,...(app?['--app',String(app)]:[])]);
    const image=nativeImage.createFromPath(file);
    if(image.isEmpty())throw Error('截图读不出来');
    const {width,height}=image.getSize();
    const scaled=width>1600?image.resize({width:1600,quality:'good'}):image;
    return {path:file,width,height,dataUrl:'data:image/jpeg;base64,'+scaled.toJPEG(82).toString('base64')};
  }

  async function look({app}={}){
    if(!available)return {text:'这台机器上没找到 agent-desktop，暂时看不了屏幕。'};
    const args=['snapshot','--compact','--max-depth',String(desk.DESK.maxDepth)];
    if(app)args.push('--app',String(app));else args.push('--surface','focused');
    const data=await call(args);
    const outline=desk.outline(data);
    return {title:outline.title,count:outline.count,text:desk.lookText(outline)};
  }

  return {available,bin,shotDir,screenshot,capture,look};
}

module.exports={createDeskTools,DEFAULT_TIMEOUT_MS};
