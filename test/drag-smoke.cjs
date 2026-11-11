// Real desktop app, synthetic input: every way of grabbing her carries her, and a drag the renderer
// stops vouching for ends by itself instead of gluing the window to the cursor.
// Run: node test/drag-smoke.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.test-output','drag');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const env={...process.env,BLUEFISH_SMOKE:'1',BLUEFISH_SMOKE_DIR:out,BLUEFISH_USER_DATA:path.join(out,'profile'),BLUEFISH_SMOKE_DRAG:'1'};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(process.execPath,[path.join(root,'node_modules/electron/cli.js'),root],{env,stdio:'inherit'});
const kill=setTimeout(()=>child.kill(),150000);
child.on('exit',()=>{
  clearTimeout(kill);
  const ev=JSON.parse(fs.readFileSync(path.join(out,'desktop-complete-smoke.json'),'utf8'));
  const d=ev.drag;delete d.log;
  console.log(JSON.stringify({error:ev.error,drag:d},null,1));
  assert.ok(!ev.error,ev.error);
  assert.ok(d.body.moved>=80,'pressing her body carries her');
  assert.ok(d.hair.moved>=40,'a long pull on the fringe carries her');
  assert.ok(d.asleep.moved>=80,'she can be carried while asleep');
  assert.equal(d.asleep.afterRelease,false,'being carried wakes her');
  assert.ok(d.bonked.moved>=80,'a press right after the double-tap bonk still carries her');
  for(const k of ['body','hair','asleep','bonked'])assert.equal(d[k].dragLeft,false,`${k}: the drag ended on release`);
  assert.equal(d.hang.dragBefore,true);
  assert.equal(d.hang.dragAfter,false,'a hung renderer drops the drag');
  assert.equal(d.hang.clickThrough,true,'and the window goes back to click-through');
  assert.equal(d.hang.followedAfterWatchdog,0,'the window no longer follows the cursor');
  console.log('drag smoke passed');
});
