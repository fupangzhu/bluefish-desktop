// Actual Windows/Electron click regression. Run with Electron, not node --test.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const outputDir=path.resolve(__dirname,'../.test-output');fs.mkdirSync(outputDir,{recursive:true});
const out=process.env.BLUEFISH_CLICK_RESULT||path.join(outputDir,'click-window.json');
const profile=path.join(outputDir,'click-regression-profile');
const setPath=app.setPath.bind(app);app.setPath=(key,value)=>setPath(key,key==='userData'?profile:value);
process.env.BLUEFISH_SMOKE='0';
require('../desktop/main.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 try{
  let win;for(let i=0;i<80;i++){win=BrowserWindow.getAllWindows()[0];if(win){try{if(await win.webContents.executeJavaScript('!!window.bluefish?.settings'))break;}catch{}}await sleep(100);}
  if(!win||!await win.webContents.executeJavaScript('!!window.bluefish'))throw Error('Avatar did not become ready');
  win.focus();await sleep(250);let moveCalls=0;const nativeMove=win.setPosition.bind(win);win.setPosition=(...args)=>{moveCalls++;return nativeMove(...args);};
  const state=async()=>({bounds:win.getBounds(),content:win.getContentSize(),zoom:win.webContents.getZoomFactor(),dom:await win.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,canvas:document.querySelector("canvas").getBoundingClientRect().width})')});
  const before=await state(),clicks=[];
  for(let i=0;i<30;i++){
    const x=Math.round(before.bounds.width*.5),y=Math.round(before.bounds.width*.45);
    win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});await sleep(100);
    win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await sleep(50);
    clicks.push(await state());if(clicks.at(-1).bounds.width>1200)break;
  }
  const after=await state(),expected=await win.webContents.executeJavaScript('({width:bluefish.settings.width,height:bluefish.settings.height})');
  const evidence={before,after,clicks,moveCalls,expected,changed:after.content[0]!==before.content[0]||after.content[1]!==before.content[1]};
  // Windows 150% DPI can round the outer frame by 1 DIP when its x changes.
  // Require exact content/canvas stability and bound every frame to the configured size.
  evidence.clicksPassed=clicks.every(s=>Math.abs(s.bounds.width-expected.width)<=1&&Math.abs(s.bounds.height-expected.height)<=1&&s.content[0]===before.content[0]&&s.content[1]===before.content[1]&&s.zoom===1&&s.dom.canvas===before.dom.canvas);
  const dragSteps=[];const {createDrag,dragBounds}=require('../desktop/drag.cjs'),start={x:0,y:0},d=createDrag(start,win.getBounds());
  for(let i=1;i<=30;i++){const next=dragBounds(d,{x:-i*2,y:0},win.getBounds(),expected);if(next)win.setBounds(next);await sleep(15);dragSteps.push(win.getSize());}
  evidence.dragSteps=dragSteps;evidence.dragPassed=dragSteps.every(([w,h])=>Math.abs(w-expected.width)<=1&&Math.abs(h-expected.height)<=1);
  fs.writeFileSync(out,JSON.stringify(evidence,null,2));console.log(JSON.stringify({before,after,moveCalls,clicksPassed:evidence.clicksPassed,dragPassed:evidence.dragPassed}));if(!evidence.clicksPassed||!evidence.dragPassed)process.exitCode=1;
 }catch(e){fs.writeFileSync(out,JSON.stringify({error:e.message}));console.error(e);process.exitCode=1;}
 app.quit();
});
