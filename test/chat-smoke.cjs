// Real desktop app + fake OpenAI-compatible model: single click opens the chat, she answers,
// a double tap and a drag do not open it. Run: node test/chat-smoke.cjs
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.test-output','chat');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const requests=[];
// Fake WeChat iLink: QR goes wait -> scanned -> confirmed, then one message from the owner.
const wx={qr:['wait','wait','scaned','confirmed'],delivered:false,sent:[],typing:[],polls:0,stranger:false};
let base='';
function ilink(path,json,send){
  if(path.startsWith('/ilink/bot/get_bot_qrcode'))return send({qrcode:'QR-SMOKE',qrcode_img_content:'https://weixin.qq.com/x/smoke-login'});
  if(path.startsWith('/ilink/bot/get_qrcode_status')){const s=wx.qr.length>1?wx.qr.shift():wx.qr[0];return send(s==='confirmed'?{status:s,bot_token:'BOT-TOKEN',ilink_bot_id:'bot@im.bot',ilink_user_id:'owner@im.wechat',baseurl:base}:{status:s});}
  if(path==='/ilink/bot/getupdates'){
    wx.polls++;
    if(!wx.delivered){wx.delivered=true;return send({ret:0,get_updates_buf:'c1',msgs:[
      {message_type:1,from_user_id:'stranger@im.wechat',context_token:'CTX-X',item_list:[{type:1,text_item:{text:'陌生人'}}]},
      {message_type:1,from_user_id:'owner@im.wechat',context_token:'CTX-SMOKE',create_time_ms:Date.now(),item_list:[{type:1,text_item:{text:'微信里问一句'}}]}]});}
    return setTimeout(()=>send({ret:0,get_updates_buf:'c1',msgs:[]}),800);
  }
  if(path==='/ilink/bot/getconfig')return send({ret:0,typing_ticket:'TICKET'});
  if(path==='/ilink/bot/sendtyping'){wx.typing.push(json.status);return send({ret:0});}
  if(path==='/ilink/bot/sendmessage'){wx.sent.push({to:json.msg.to_user_id,ctx:json.msg.context_token,text:json.msg.item_list[0].text_item.text});return send({ret:0});}
  send({ret:-1});
}
const server=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const send=v=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
    if(req.url.startsWith('/ilink/'))return ilink(req.url,body?JSON.parse(body):{},send);
    if(req.url==='/models')return send({data:[{id:'fake-model'}]});
    const json=JSON.parse(body||'{}');requests.push({auth:req.headers.authorization,model:json.model,tools:(json.tools||[]).map(t=>t.function.name),last:json.messages?.at(-1)?.content});
    if(json.tools)return send({choices:[{message:{content:'',tool_calls:[
      {id:'a',type:'function',function:{name:'act',arguments:'{"action":"nod"}'}},
      {id:'b',type:'function',function:{name:'reply',arguments:'{"reference":"主人在叫我，回一声"}'}}]}}],usage:{total_tokens:100}});
    send({choices:[{message:{content:'在呢。今天怎么啦？'}}],usage:{total_tokens:50}});
  });
});
server.listen(0,'127.0.0.1',()=>{
  base='http://127.0.0.1:'+server.address().port;
  const env={...process.env,BLUEFISH_SMOKE:'1',BLUEFISH_SMOKE_DIR:out,BLUEFISH_USER_DATA:path.join(out,'profile'),BLUEFISH_SMOKE_CHAT:base,BLUEFISH_WEIXIN_BASE:base};
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(process.execPath,[path.join(root,'node_modules/electron/cli.js'),root],{env,stdio:'inherit'});
  const kill=setTimeout(()=>{child.kill();},90000);
  child.on('exit',()=>{
    clearTimeout(kill);server.close();
    const ev=JSON.parse(fs.readFileSync(path.join(out,'desktop-complete-smoke.json'),'utf8'));
    const chat=ev.chat;
    console.log(JSON.stringify({error:ev.error,chat,requests,wx},null,1));
    // WeChat
    const w=chat.weixin;
    assert.ok(w,'weixin section ran');
    assert.equal(w.qrShown,true,'QR code shown after pressing 连接微信');
    assert.equal(w.qrStatus,'等待扫码');
    assert.equal(w.connected,true,'confirming the scan connects');
    assert.ok(w.events.includes('heard:weixin:微信里问一句'),'the owner message reached the brain');
    assert.ok(!w.events.some(e=>e.includes('陌生人')),'a stranger is ignored');
    assert.deepEqual(wx.sent.map(s=>s.text),['在呢。','今天怎么啦？'],'her lines go back over WeChat');
    assert.ok(wx.sent.every(s=>s.ctx==='CTX-SMOKE'&&s.to==='owner@im.wechat'));
    assert.ok(wx.typing.includes(1),'typing indicator shown in WeChat');
    assert.equal(w.tokenOnDisk,false,'the bot token is never stored in plain text');
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
