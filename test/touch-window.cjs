// Real Electron pointer / WebGL regression. Run: node node_modules/electron/cli.js test/touch-window.cjs
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const dock=require('../desktop/dock.cjs');
const OUT=path.resolve(__dirname,'../.test-output/touch');
fs.mkdirSync(OUT,{recursive:true});app.setPath('userData',path.join(OUT,'profile'));
app.commandLine.appendSwitch('force-device-scale-factor','1.5');
const preload=path.join(OUT,'preload.cjs');
fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pet',{
 onState:cb=>ipcRenderer.on('test-state',(_e,s)=>cb(s)),onPointer:cb=>ipcRenderer.on('test-pointer',(_e,p)=>cb(p)),onAction:()=>{},
 setInteractive:hit=>ipcRenderer.send('test-interactive',hit),drag:on=>ipcRenderer.send('test-drag',on),tow:x=>ipcRenderer.send('test-tow',x),menu:()=>{},zoom:()=>{}
});`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let win,server,dragEvents=[],towEvents=[],errors=[];
ipcMain.on('test-tow',(_e,x)=>towEvents.push(x));
ipcMain.on('test-drag',(_e,on)=>dragEvents.push(on));
app.whenReady().then(async()=>{
  const evidence={};
  try{
    const {createServer}=await import(pathToFileURL(path.resolve(__dirname,'../server.mjs')));
    server=createServer({editor:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    win=new BrowserWindow({width:598,height:345,useContentSize:true,show:false,frame:false,transparent:true,webPreferences:{preload,backgroundThrottling:false,offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    const wc=win.webContents;
    // Production keeps sending the global pointer every 33ms, including while
    // stationary. Preserve that input cadence in the hidden rendering harness.
    let latestPointer=null;const send=wc.send.bind(wc);
    wc.send=(channel,...args)=>{if(channel==='test-pointer')latestPointer=args[0];return send(channel,...args);};
    const pointerTimer=setInterval(()=>{if(latestPointer&&!win.isDestroyed())send('test-pointer',latestPointer);},33);
    win.on('closed',()=>clearInterval(pointerTimer));
    wc.on('console-message',({level,message})=>{if(level==='error'&&!message.includes('GPU stall'))errors.push(message);});
    wc.on('render-process-gone',(_e,details)=>errors.push(JSON.stringify(details)));
    const js=code=>wc.executeJavaScript(code);
    await win.loadURL(base+'/overlay.html');
    let ready=false;for(let i=0;i<200;i++){ready=await js('!!window.bluefish?.renderer');if(ready)break;await sleep(100);}assert.ok(ready,'overlay loaded');
    const configure=async(size,docked)=>{
      const l=dock.layout(size,docked);win.setContentSize(l.width,l.height);
      wc.send('test-state',{size,docked,idle:false,follow:false,reduced:false,pose:{yaw:0,pitch:0,roll:0}});
      await sleep(160);
      await js('window.bluefish.motion.reset();window.bluefish.motion.follow=false;window.bluefish.motion.idle=false;');await sleep(100);
    };
    const target=async(name)=>js(`(()=>{
      const b=window.bluefish,l=b.renderer.byName.get(${JSON.stringify(name)}),s=b.motion.current,p=b.position(),r=b.renderer;
      // Prefer opaque triangle centers over edges, then ask the occlusion-aware picker.
      for(let i=0;i<l.points.length;i+=3){
        const a=l.points[i],v=l.points[i+1],c=l.points[i+2];
        const q=r.project((a[0]+v[0]+c[0])/3,(a[1]+v[1]+c[1])/3,s,l);
        const x=Math.round(p.left+(q[0]+1)*b.state.size/2),y=Math.round(p.top+(1-q[1])*b.state.size/2);
        if(x>2&&y>2&&x<innerWidth-2&&y<innerHeight-2&&b.partAt(x,y)===${JSON.stringify(name)})return {x,y};
      }return null;
    })()`);
    const input=(type,p)=>{if(type==='mouseMove')latestPointer={...p,gx:0,gy:0};wc.sendInputEvent({type,...p,button:'left',clickCount:1});};
    const press=async p=>{latestPointer={...p,gx:0,gy:0};input('mouseMove',p);input('mouseDown',p);await sleep(25);};
    // Offscreen sendInputEvent drops coordinates outside its viewport; the global
    // pointer stream above already covers pulling beyond the silhouette.
    const release=async p=>{const b=win.getContentBounds(),point={x:Math.max(1,Math.min(b.width-2,p.x)),y:Math.max(1,Math.min(b.height-2,p.y))};latestPointer={...point,gx:0,gy:0};input('mouseUp',point);await sleep(30);};
    const shot=async name=>{await sleep(50);fs.writeFileSync(path.join(OUT,name+'.png'),(await wc.capturePage()).toPNG());};
    evidence.sizes=[];
    for(const size of [150,240,460])for(const docked of [true,false]){
      await configure(size,docked);
      const points={};for(const name of ['ahoge','ear_l','ear_r']){points[name]=await target(name);assert.ok(points[name],`${name} selectable at ${size}, docked=${docked}`);}
      dragEvents=[];towEvents=[];
      // Docked: pinch the far end of the curl, where a person grabs it to lead her along.
      const p=docked?await js(`(()=>{const b=window.bluefish,r=b.renderer,l=r.byName.get('ahoge'),pos=b.position(),s=b.state.size;let best=null,score=Infinity;
        for(let i=0;i<l.points.length;i+=3){const a=l.points[i],v=l.points[i+1],c=l.points[i+2],sx=(a[0]+v[0]+c[0])/3,sy=(a[1]+v[1]+c[1])/3;
          const q=r.project(sx,sy,b.motion.current,l),x=Math.round(pos.left+(q[0]+1)*s/2),y=Math.round(pos.top+(1-q[1])*s/2);
          const d=Math.hypot(sx-1540,sy-285);if(d<score&&x>2&&y>2&&x<innerWidth-2&&b.partAt(x,y)==='ahoge'){score=d;best={x,y};}}
        return best;})()`):points.ahoge;
      assert.ok(p,'ahoge grip at '+size);await press(p);
      if(docked){
        // Docked: a sideways tug past the threshold leads the pet along the taskbar, with no angry face or guard.
        const start=await js('({...bluefish.motion.touch.tow.start})'),screenOf=q=>({sx:start.x+q.x-p.x,sy:start.y+q.y-p.y});
        // Pull until the strand of the pinched point is almost at its engage length: it bends and
        // straightens, but the head stays put until the strand is taut.
        const rope=await js('({length:bluefish.motion.touch.tow.length,root:{...bluefish.motion.touch.tow.root}})');
        const reachX=ratio=>Math.sqrt(Math.max(0,(ratio*rope.length)**2-rope.root.y**2))-rope.root.x;
        const small={x:p.x+Math.max(1,Math.floor(reachX(.97))),y:p.y};wc.send('test-pointer',{...small,...screenOf(small),gx:0,gy:0});await sleep(300);
        assert.equal(await js('bluefish.motion.touch.tow.engaged'),false,'pulling and straightening never move the head');
        assert.ok(['straighten','taut'].includes(await js('bluefish.renderer.ahogePose?.phase')),'the strand is straightening before she moves');
        // The head trails one taut strand length behind the pointer.
        const lead={x:p.x+Math.round(size*.5),y:p.y};wc.send('test-pointer',{...lead,...screenOf(lead),gx:0,gy:0});
        for(let frame=0;frame<40;frame++){if(await js('bluefish.motion.touch.tow.offset>'+size*.2))break;await sleep(50);}
        const towed=await js('({offset:bluefish.motion.touch.tow.offset,towing:bluefish.motion.current.towing,pain:bluefish.motion.current.pain,guard:bluefish.motion.current.guard,part:bluefish.touchInput.active?.part})');
        assert.ok(towed.towing===1&&towed.offset>size*.2,'head follows the tug: '+JSON.stringify(towed));
        assert.ok(towed.pain<.08&&towed.guard===0,'no angry face while being towed');
        assert.ok(towEvents.length>2&&towEvents.at(-1)>towEvents[0],'window asked to move right: '+towEvents.slice(-3));
        assert.deepEqual(dragEvents,[],'the tow never uses the body drag');
        if(size===460)await shot('tow-docked');
        await release(lead);
        let dip=0;for(let frame=0;frame<30&&dip<.05;frame++){dip=await js('bluefish.motion.current.dip');await sleep(50);}
        assert.ok(dip>.05,'release after moving always dips');
        if(size===460)await shot('dip-docked');
        // Longest duck: .42s in + 2.3s hold + .85s rise.
        let dipEnd=1;for(let frame=0;frame<60&&dipEnd!==0;frame++){await sleep(100);dipEnd=await js('bluefish.motion.current.dip');}
        assert.equal(dipEnd,0,'the dip ends by itself');
        // Lifting too high slips out of the fingers.
        await press(p);const start2=await js('({...bluefish.motion.touch.tow.start})');
        const up={x:p.x,y:p.y-Math.round(size*.25)};wc.send('test-pointer',{...up,sx:start2.x,sy:start2.y-Math.round(size*.25),gx:0,gy:0});
        let slipped=false;for(let frame=0;frame<30&&!slipped;frame++){slipped=await js('bluefish.motion.touch.anchor===null&&!!bluefish.motion.touch.grab?.slip');await sleep(50);}
        assert.ok(slipped,'lifting the ahoge too high slips it');
        await release(p);await sleep(1000);
        evidence.sizes.push({size,docked,points,towed,dip,towEvents:towEvents.length});
        continue;
      }
      // The global pointer stream keeps the grab alive even beyond the painted silhouette.
      const tug={x:p.x+Math.round(size*.06),y:p.y-Math.round(size*.16)};
      wc.send('test-pointer',{...tug,gx:0,gy:0});
      // Wait for rendered input rather than assuming a GPU frame fits in 160ms.
      for(let frame=0;frame<40;frame++){if(await js('window.bluefish.motion.current.pain>.8&&bluefish.motion.current.guard>.9'))break;await sleep(50);}
      const held=await js('({...window.bluefish.motion.current,part:window.bluefish.touchInput.active?.part})');
      assert.ok(held.pain>.8,`pain active at ${size}: ${JSON.stringify({pain:held.pain,part:held.part,point:p})}`);assert.equal(held.part,'ahoge');assert.deepEqual(dragEvents,[],'hair tug never drags native window');
      assert.ok(held.guard>.9&&held.shiftX>0&&held.shiftY<0,'the head follows the tug while both hands protect it');
      if(size===460){await shot(docked?'pain-docked':'pain-free');}
      // Keep release inside the window even when a simulated global pointer went outside it.
      await release(p);await sleep(700);
      assert.equal(await js('window.bluefish.motion.current.pain'),0,'pain recovers after release');assert.equal(await js('bluefish.motion.current.guard'),0);
      evidence.sizes.push({size,docked,points,pain:held.pain,dragEvents:[...dragEvents]});
    }
    await configure(460,false);await shot('rest-free');
    // Compare ear moods with a fixed head pose so only the emotional change moves the tips.
    evidence.moods=[];
    for(const mood of ['sulk','happy']){
      const state=await js(`(()=>{const b=window.bluefish;b.pause(true);b.motion.reset();b.motion.idle=false;b.motion.follow=false;
        b.motion.override=${mood==='sulk'?'(b.peek.forceSulk(),b.peek.snapshot().override)':'null'};
        ${mood==='happy'?'b.motion.gesture("happy");':''}
        for(let i=0;i<${mood==='sulk'?90:54};i++)b.motion.step(1/60);
        b.renderer.render({...b.motion.current,yaw:0,pitch:0,roll:0,hair:0,secondary:false,breath:0});
        return {mood:${JSON.stringify(mood)},earMood:b.motion.current.earMood};})()`);
      assert.ok(mood==='sulk'?state.earMood<-.95:state.earMood>.85);
      await shot('mood-'+mood);evidence.moods.push(state);
    }
    await js('window.bluefish.motion.override=null;window.bluefish.motion.reset();window.bluefish.pause(false)');await sleep(100);
    // Grab the far end of the curl and inspect drag / straightening / stretch.
    const pinch=await js(`(()=>{const b=window.bluefish,r=b.renderer,l=r.byName.get('ahoge'),p=b.position();let best=null,score=Infinity;
      for(let i=0;i<l.points.length;i+=3){const a=l.points[i],v=l.points[i+1],c=l.points[i+2],sx=(a[0]+v[0]+c[0])/3,sy=(a[1]+v[1]+c[1])/3;
        const q=r.project(sx,sy,b.motion.current,l),x=Math.round(p.left+(q[0]+1)*460/2),y=Math.round(p.top+(1-q[1])*460/2);
        const d=Math.hypot(sx-1540,sy-285);if(d<score&&b.partAt(x,y)==='ahoge'){score=d;best={x,y};}}
      return best;})()`);
    assert.ok(pinch);await press(pinch);evidence.pinch=[];
    for(const [name,dx,dy] of [['grip',0,0],['drag',8,-2],['straighten',23,-7],['stretch',40,-11],['limit',85,-15]]){
      const p={x:pinch.x+dx,y:pinch.y+dy};input('mouseMove',p);await sleep(150);await shot('pinch-'+name);
      const detail=await js(`(()=>{const b=window.bluefish,r=b.renderer,g=b.motion.touch.grab,l=r.byName.get('ahoge'),s=b.motion.current,p=b.position();
        const q=r.project(g.source.x,g.source.y,s,l,false,g.binding),root=r.project(l.pivot[0],l.pivot[1],s,l),fixed=r.project(l.pivot[0],l.pivot[1],s,l,true);
        return {phase:r.ahogePose.phase,saturated:r.ahogePose.saturated,stretch:r.ahogePose.stretch,pin:{x:p.left+(q[0]+1)*460/2,y:p.top+(1-q[1])*460/2},rootError:Math.hypot(root[0]-fixed[0],root[1]-fixed[1])};})()`);
      assert.ok(detail.rootError<.0001,'root remains fixed');assert.ok(detail.stretch<=.18,'limited axial stretch');
      if(!detail.saturated)assert.ok(Math.hypot(detail.pin.x-p.x,detail.pin.y-p.y)<1.5,'pin stays under cursor through elastic range');evidence.pinch.push({name,...detail});
    }
    await release(pinch);await sleep(750);await shot('pinch-released');
    assert.equal(await js('window.bluefish.motion.touch.grab'),null);
    // Fast-forward the idle clock without waiting two real minutes.
    await js('window.bluefish.motion.idle=true;window.bluefish.motion.touch.nextEarAt=window.bluefish.motion.touch.idleTime+.05;');
    await sleep(110);const flutter=await js('({l:window.bluefish.motion.touch.ears.l,r:window.bluefish.motion.touch.ears.r})');
    assert.ok(flutter.l?.idle||flutter.r?.idle,'automatic idle ear flutter');await shot('idle-ear-flutter');
    await js('window.bluefish.motion.idle=false');await sleep(500);
    evidence.ears=[];
    for(const side of ['l','r'])for(const [random,count] of [[.1,1],[.9,2]]){
      await js(`window.bluefish.motion.touch.random=()=>${random};void 0`);
      const p=await target('ear_'+side);dragEvents=[];await press(p);await release(p);
      const ear=await js(`window.bluefish.motion.touch.ears.${side}`);assert.equal(ear?.count,count);
      const other=side==='l'?'r':'l';assert.equal(await js(`window.bluefish.motion.touch.ears.${other}`),null);
      await sleep(25);if(count===2)await shot('ear-'+side+'-fold');
      assert.deepEqual(dragEvents,[],'ear tap never starts native drag');
      await sleep(500);assert.equal(await js(`window.bluefish.motion.touch.ears.${side}`),null);
      evidence.ears.push({side,count});
    }
    const earPoint=await target('ear_l');dragEvents=[];await press(earPoint);const moved={x:earPoint.x+30,y:earPoint.y};input('mouseMove',moved);await release(moved);await sleep(50);
    assert.deepEqual(dragEvents,[true,false]);assert.equal(await js('window.bluefish.motion.touch.ears.l'),null);evidence.earDrag=dragEvents;
    const body=await js(`(()=>{const b=window.bluefish;for(let y=150;y<350;y+=5)for(let x=160;x<300;x+=5)if(b.hitTest(x,y)&&!b.partAt(x,y))return {x,y};})()`);
    assert.ok(body);dragEvents=[];await press(body);await release(body);await sleep(30);assert.deepEqual(dragEvents,[true,false]);evidence.bodyDrag=dragEvents;
    // Releasing through focus loss must not leave a stuck pain expression.
    const hair=await target('ahoge');await press(hair);input('mouseMove',{x:hair.x+40,y:hair.y+30});await sleep(100);await js('window.dispatchEvent(new Event("blur"))');await sleep(750);
    assert.equal(await js('window.bluefish.motion.current.pain'),0);assert.equal(await js('window.bluefish.touchInput.active'),null);await release(hair);
    // A real double click on the head covers it, clips it below the taskbar, then returns.
    await configure(240,true);
    await js('bluefish.motion.touch.random=()=>0;void 0');
    const scalp=await js('(()=>{const b=bluefish,p=b.position(),s=b.state.size;return {x:Math.round(p.left+s*.5),y:Math.round(p.top+s*.46)};})()');
    assert.ok(await js(`bluefish.hitTest(${scalp.x},${scalp.y})`));
    await press(scalp);await release(scalp);assert.equal(await js('bluefish.motion.touch.bonking'),false);
    await press(scalp);await release(scalp);assert.equal(await js('bluefish.motion.touch.bonking'),true);
    const until=async (code,ms)=>{const end=Date.now()+ms;while(Date.now()<end){if(await js(code))return;await sleep(30);}assert.fail(code);};
    await until('bluefish.motion.current.guard>.8',900);await shot('bonk-guard');
    await until('bluefish.motion.current.dip>.25',1400);
    // The shared duck sinks behind the ledge but never fades: the hands stay on the taskbar edge.
    const handsLeft=await js('(()=>{const c=document.querySelector("#hands"),a=c.getContext("2d").getImageData(0,0,c.width,c.height).data;return a.some((v,i)=>i%4===3&&v>24);})()');
    assert.ok(handsLeft,'hands stay visible');assert.equal(await js('getComputedStyle(document.querySelector("#avatar")).opacity'),'1');await shot('bonk-hidden');
    await sleep(600);assert.ok(await js('bluefish.motion.current.dip>.1'));
    await until('!bluefish.motion.touch.bonking',6500);assert.equal(await js('bluefish.motion.current.dip'),0);await shot('bonk-back');
    evidence.bonk=true;
    await configure(460,false);
    // Exact-source alpha: the transparent inside of the loop is never a grab target.
    const hole=await js(`(()=>{const b=window.bluefish,r=b.renderer,l=r.byName.get('ahoge'),p=b.position(),q=r.project(1370,295,b.motion.current,l);return b.partAt(p.left+(q[0]+1)*460/2,p.top+(1-q[1])*460/2);})()`);
    assert.notEqual(hole,'ahoge');evidence.loopHole=hole;
    // Preview console uses the same reactions as the desktop overlay.
    await win.loadURL(base+'/');for(let i=0;i<200;i++){if(await js('!!(window.bluefish?.renderer&&window.bluefish.motion.current&&window.bluefish.renderer.drawn?.length)'))break;await sleep(100);}
    assert.ok(await js('!!window.bluefish?.renderer'),'console renderer loaded');
    await js(`(()=>{const b=window.bluefish,r=b.renderer,l=r.byName.get('ahoge'),s=b.motion.current,rect=r.canvas.getBoundingClientRect(),source={x:1535,y:280},q=r.project(source.x,source.y,s,l);
      const p={x:rect.left+(q[0]+1)*rect.width/2,y:rect.top+(1-q[1])*rect.height/2};
      b.motion.touch.startPull(p,{source});b.motion.touch.movePull({x:p.x+40,y:p.y-20},rect.width);})()`);await sleep(200);await shot('pain-console');
    assert.equal(errors.length,0,errors.join('\n'));evidence.errors=errors;evidence.passed=true;
    console.log(JSON.stringify(evidence,null,2));
  }catch(error){evidence.passed=false;evidence.error=error.stack;evidence.errors=errors;console.error(error);process.exitCode=1;}
  finally{fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(evidence,null,2));win?.destroy();server?.close();app.exit(process.exitCode||0);}
});
