const {app}=require('electron'),path=require('node:path'),fs=require('node:fs');
const out=path.resolve(__dirname,'../.test-output');fs.mkdirSync(out,{recursive:true});const report=path.join(out,'taskbar-smoke.json');if(fs.existsSync(report))fs.unlinkSync(report);
const setPath=app.setPath.bind(app);app.setPath=(key,value)=>setPath(key,key==='userData'?path.join(out,'taskbar-test-profile'):value);
process.env.BLUEFISH_SMOKE='1';process.env.BLUEFISH_SMOKE_DIR=out;
app.on('will-quit',()=>{try{const data=JSON.parse(fs.readFileSync(report,'utf8'));const passed=data.ready&&data.editorReady&&data.hands===2&&Math.abs(data.editorSetSize-121)<=1&&data.sizes.every(s=>Math.abs(s.width-s.requested)<=1&&Math.abs(s.taskbarDelta)<=1);console.log(JSON.stringify({passed,editorReady:data.editorReady,editorSetSize:data.editorSetSize,sizes:data.sizes}));if(!passed)process.exitCode=1;}catch(e){console.error(e);process.exitCode=1;}});
require('../desktop/main.cjs');
