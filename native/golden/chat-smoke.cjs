// Native chat smoke: a fake OpenAI-compatible model and a fake WeChat iLink server, then the native
// pet run with BLUEFISH_SMOKE_CHAT. It fills the settings window, opens the bubble with a single
// click, says 在吗, connects WeChat (QR wait -> scanned -> confirmed), gets one line from the owner
// and one from a stranger, and fetches the model list.
// Run: node native/golden/chat-smoke.cjs   (after `cargo build --release` in native/)
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const exe=path.join(__dirname,'..','target','release','bluefish.exe');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'bluefish-chat-'));
const out=path.join(data,'smoke.json');
const requests=[],wx={qr:['wait','wait','scaned','confirmed'],delivered:false,sent:[],typing:[]};
let base='';
function ilink(url,json,send){
  if(url.startsWith('/ilink/bot/get_bot_qrcode'))return send({qrcode:'QR-SMOKE',qrcode_img_content:'https://weixin.qq.com/x/smoke-login'});
  if(url.startsWith('/ilink/bot/get_qrcode_status')){const s=wx.qr.length>1?wx.qr.shift():wx.qr[0];return send(s==='confirmed'?{status:s,bot_token:'BOT-TOKEN',ilink_bot_id:'bot@im.bot',ilink_user_id:'owner@im.wechat',baseurl:base}:{status:s});}
  if(url==='/ilink/bot/getupdates'){
    if(!wx.delivered){wx.delivered=true;return send({ret:0,get_updates_buf:'c1',msgs:[
      {message_type:1,from_user_id:'stranger@im.wechat',context_token:'CTX-X',item_list:[{type:1,text_item:{text:'陌生人'}}]},
      {message_type:1,from_user_id:'owner@im.wechat',context_token:'CTX-SMOKE',item_list:[{type:1,text_item:{text:'微信里问一句'}}]}]});}
    return setTimeout(()=>send({ret:0,get_updates_buf:'c1',msgs:[]}),800);
  }
  if(url==='/ilink/bot/getconfig')return send({ret:0,typing_ticket:'TICKET'});
  if(url==='/ilink/bot/sendtyping'){wx.typing.push(json.status);return send({ret:0});}
  if(url==='/ilink/bot/sendmessage'){wx.sent.push({to:json.msg.to_user_id,ctx:json.msg.context_token,text:json.msg.item_list[0].text_item.text});return send({ret:0});}
  send({ret:-1});
}
const server=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const send=v=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
    if(req.url.startsWith('/ilink/'))return ilink(req.url,body?JSON.parse(body):{},send);
    if(req.url==='/models')return send({data:[{id:'fake-model'},{id:'fake-vision'}]});
    const json=JSON.parse(body||'{}');
    requests.push({auth:req.headers.authorization,model:json.model,tools:(json.tools||[]).map(t=>t.function.name),last:json.messages?.at(-1)?.content});
    if(json.tools)return send({choices:[{message:{content:'',tool_calls:[
      {id:'a',type:'function',function:{name:'act',arguments:'{"action":"nod"}'}},
      {id:'b',type:'function',function:{name:'reply',arguments:'{"reference":"主人在叫我，回一声"}'}}]}}],usage:{total_tokens:100}});
    send({choices:[{message:{content:'在呢。今天怎么啦？'}}],usage:{total_tokens:50}});
  });
});
server.listen(0,'127.0.0.1',()=>{
  base='http://127.0.0.1:'+server.address().port;
  const env={...process.env,BLUEFISH_NATIVE_DATA:data,BLUEFISH_SMOKE_CHAT:out,BLUEFISH_SMOKE_MODEL:base,BLUEFISH_WEIXIN_BASE:base,APPDATA:data};
  const child=spawn(exe,[],{env,stdio:'inherit'});
  const kill=setTimeout(()=>child.kill(),90000);
  const poll=setInterval(()=>{if(fs.existsSync(out)){clearInterval(poll);setTimeout(()=>child.kill(),300);}},500);
  child.on('exit',()=>{
    clearTimeout(kill);clearInterval(poll);server.close();
    const r=JSON.parse(fs.readFileSync(out,'utf8'));
    console.log(JSON.stringify({r,requests,wx},null,1));
    assert.ok(!r.error,r.error);
    assert.equal(r.configured.hasKey,true,'the key from the settings window was saved');
    assert.equal(r.configured.model,'fake-model');
    assert.equal(r.beforeConfirm.bubbleVisible,false,'the bubble waits out the double-tap window');
    assert.equal(r.afterClick.bubbleVisible,true,'a single click opens the chat');
    assert.equal(r.afterClick.mode,'Some(Chat)');
    assert.ok(r.answered.lines.includes('me::在吗'),'her bubble shows what was typed');
    assert.ok(r.answered.lines.includes('her:desktop:在呢。')&&r.answered.lines.includes('her:desktop:今天怎么啦？'),'she answers in two lines');
    assert.equal(requests[0].auth,'Bearer smoke-key');
    assert.deepEqual(requests[0].tools,['reply','act','wait','screenshot','look','see','stop']);
    assert.equal(r.weixin.weixin,'connected','scanning connects WeChat');
    assert.ok(wx.sent.some(s=>s.text==='在呢。'&&s.ctx==='CTX-SMOKE'&&s.to==='owner@im.wechat'),'her answer goes back over WeChat');
    assert.ok(!requests.some(q=>String(q.last).includes('陌生人')),'a stranger is ignored');
    assert.ok(r.weixin.lines.some(l=>l.startsWith('her:weixin:')),'the WeChat line shows on the desktop with its channel');
    assert.ok(wx.typing.includes(1),'typing shows in WeChat');
    assert.equal(r.weixin.plainSecret,false,'no key or token in plain text on disk');
    assert.match(r.models.usageText,/fake-vision/,'the model list comes back');
    console.log('native chat smoke passed');
  });
});
