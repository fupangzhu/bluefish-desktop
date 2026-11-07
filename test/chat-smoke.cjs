// Real desktop app + fake OpenAI-compatible model: single click opens the chat, she answers,
// a double tap and a drag do not open it. Run: node test/chat-smoke.cjs
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.test-output','chat');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const requests=[];
const server=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const send=v=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
    if(req.url==='/models')return send({data:[{id:'fake-model'}]});
    const json=JSON.parse(body||'{}');requests.push({auth:req.headers.authorization,model:json.model,tools:(json.tools||[]).map(t=>t.function.name),last:json.messages?.at(-1)?.content});
    if(json.tools)return send({choices:[{message:{content:'',tool_calls:[
      {id:'a',type:'function',function:{name:'act',arguments:'{"action":"nod"}'}},
      {id:'b',type:'function',function:{name:'reply',arguments:'{"reference":"主人在叫我，回一声"}'}}]}}],usage:{total_tokens:100}});
    send({choices:[{message:{content:'在呢。今天怎么啦？'}}],usage:{total_tokens:50}});
  });
});
server.listen(0,'127.0.0.1',()=>{
  const base='http://127.0.0.1:'+server.address().port;
  const env={...process.env,BLUEFISH_SMOKE:'1',BLUEFISH_SMOKE_DIR:out,BLUEFISH_USER_DATA:path.join(out,'profile'),BLUEFISH_SMOKE_CHAT:base};
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(process.execPath,[path.join(root,'node_modules/electron/cli.js'),root],{env,stdio:'inherit'});
  const kill=setTimeout(()=>{child.kill();},90000);
  child.on('exit',()=>{
    clearTimeout(kill);server.close();
    const ev=JSON.parse(fs.readFileSync(path.join(out,'desktop-complete-smoke.json'),'utf8'));
    const chat=ev.chat;
    console.log(JSON.stringify({error:ev.error,chat,requests},null,1));
    assert.ok(!ev.error,ev.error);
    assert.equal(chat.settings.hasKey,true);
    assert.equal(chat.openBeforeConfirm,false,'the bubble waits out the double-tap window');
    assert.equal(chat.openAfterClick,true,'a single click opens the chat');
    assert.deepEqual(chat.lines.filter(l=>!l.startsWith('notice')),['me:在吗','her:在呢。','her:今天怎么啦？']);
    assert.equal(chat.openAfterDoubleTap,false,'a double tap is not a chat click');
    assert.equal(chat.openAfterDrag,false,'a drag is not a chat click');
    assert.equal(requests[0].auth,'Bearer smoke-key');assert.deepEqual(requests[0].tools,['reply','act','wait','stop']);
    assert.ok(chat.bubbleBounds.y+chat.bubbleBounds.height<=chat.petBounds.y+chat.petBounds.height,'bubble sits above the pet');
    console.log('chat smoke passed');
  });
});
