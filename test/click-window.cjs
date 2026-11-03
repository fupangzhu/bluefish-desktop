// Actual Windows/Electron click regression. Run with Electron, not node --test.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const dock=require('../desktop/dock.cjs');
const outputDir=path.resolve(__dirname,'../.test-output');fs.mkdirSync(outputDir,{recursive:true});
const out=process.env.BLUEFISH_CLICK_RESULT||path.join(outputDir,'click-window.json');
const profile=path.join(outputDir,'click-regression-profile');
try{fs.rmSync(path.join(profile,'window.json'),{force:true});}catch{}
const setPath=app.setPath.bind(app);app.setPath=(key,value)=>setPath(key,key==='userData'?profile:value);
process.env.BLUEFISH_SMOKE='0';
require('../desktop/main.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const petWindow=()=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('/overlay.html'));
app.whenReady().then(async()=>{
 try{
  let win;for(let i=0;i<80;i++){win=petWindow();if(win){try{if(await win.webContents.executeJavaScript('!!(window.bluefish&&window.bluefish.renderer)'))break;}catch{}}await sleep(100);}
  if(!win||!await win.webContents.executeJavaScript('!!(window.bluefish&&window.bluefish.renderer)'))throw Error('Avatar did not become ready');
  win.focus();await sleep(250);let moveCalls=0;const nativeMove=win.setPosition.bind(win);win.setPosition=(...args)=>{moveCalls++;return nativeMove(...args);};
  const L=dock.layout(240,true);
  const state=async()=>({bounds:win.getBounds(),content:win.getContentSize(),zoom:win.webContents.getZoomFactor(),dom:await win.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,canvas:document.querySelector("canvas").getBoundingClientRect().width})')});
  // Find a point that is on the character: ask the page's hit test, else window center-x at 40% height.
  const target=await win.webContents.executeJavaScript(`(()=>{const w=innerWidth,h=innerHeight;const fallback={x:Math.round(w/2),y:Math.round(h*.4),hit:false};const hit=window.bluefish&&window.bluefish.hitTest;if(!hit)return fallback;for(const fy of [.4,.3,.5,.2,.6])for(const fx of [.5,.45,.55,.4,.6]){const x=Math.round(w*fx),y=Math.round(h*fy);try{if(hit(x,y))return {x,y,hit:true};}catch{}}return fallback;})()`);
  const before=await state(),clicks=[];
  for(let i=0;i<30;i++){
    win.webContents.sendInputEvent({type:'mouseDown',x:target.x,y:target.y,button:'left',clickCount:1});await sleep(100);
    win.webContents.sendInputEvent({type:'mouseUp',x:target.x,y:target.y,button:'left',clickCount:1});await sleep(50);
    clicks.push(await state());if(clicks.at(-1).bounds.width>1200)break;
  }
  const after=await state();const evidence={target,expectedLayout:L,before,after,clicks,moveCalls,changed:after.bounds.width!==before.bounds.width||after.bounds.height!==before.bounds.height};
  evidence.layoutPassed=Math.abs(before.bounds.width-L.width)<=1&&Math.abs(before.bounds.height-L.height)<=1;
  evidence.clicksPassed=clicks.every(s=>s.bounds.width===before.bounds.width&&s.bounds.height===before.bounds.height&&s.zoom===1&&s.dom.canvas===before.dom.canvas);
  const dragSteps=[];const {createDrag,dragBounds}=require('../desktop/drag.cjs'),start={x:0,y:0},d=createDrag(start,win.getBounds());
  for(let i=1;i<=30;i++){const next=dragBounds(d,{x:-i*2,y:-i},win.getBounds(),{width:L.width,height:L.height});if(next)win.setBounds(next);await sleep(15);dragSteps.push(win.getSize());}
  evidence.dragSteps=dragSteps;evidence.dragPassed=dragSteps.every(([w,h])=>Math.abs(w-L.width)<=1&&Math.abs(h-L.height)<=1);
  fs.writeFileSync(out,JSON.stringify(evidence,null,2));console.log(JSON.stringify({target,before,after,moveCalls,layoutPassed:evidence.layoutPassed,clicksPassed:evidence.clicksPassed,dragPassed:evidence.dragPassed}));if(!evidence.layoutPassed||!evidence.clicksPassed||!evidence.dragPassed)process.exitCode=1;
 }catch(e){fs.writeFileSync(out,JSON.stringify({error:e.message}));console.error(e);process.exitCode=1;}
 app.quit();
});
