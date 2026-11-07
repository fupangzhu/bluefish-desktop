import test from 'node:test';
import assert from 'node:assert/strict';
import {WeixinClient,messageText,sessionExpired,WEIXIN} from '../src/brain/weixin.mjs';
import {encodeQr,qrSvg} from '../src/qr.mjs';

// ---- QR ----------------------------------------------------------------------------------------
test('QR codes pick the smallest version and draw the three finder patterns',()=>{
  const q=encodeQr('https://weixin.qq.com/x/cAbCdEfGhIj');
  assert.equal(q.version,3);assert.equal(q.size,29);
  const finder=(x0,y0)=>{for(let y=0;y<7;y++)for(let x=0;x<7;x++){const d=Math.max(Math.abs(x-3),Math.abs(y-3));assert.equal(q.modules[y0+y][x0+x],d!==2,`finder at ${x0},${y0}`);}};
  finder(0,0);finder(q.size-7,0);finder(0,q.size-7);
  assert.equal(q.modules[q.size-8][8],true,'dark module');
  assert.ok(q.mask>=0&&q.mask<8);
  assert.match(qrSvg('x'),/^<svg[^>]+viewBox="0 0 29 29"/);
  assert.throws(()=>encodeQr('x'.repeat(3000)));
});

// ---- fake iLink server ---------------------------------------------------------------------------
function fakeIlink(){
  const s={calls:[],qrStates:['wait','scaned','confirmed'],updates:[],sent:[],typing:[],expire:false};
  s.fetch=async(url,init={})=>{
    const u=new URL(url),body=init.body?JSON.parse(init.body):null;s.calls.push({path:u.pathname,headers:init.headers,body});
    const ok=v=>new Response(JSON.stringify(v),{status:200});
    switch(u.pathname){
      case '/ilink/bot/get_bot_qrcode':return ok({qrcode:'QR1',qrcode_img_content:'https://weixin.qq.com/x/fake'});
      case '/ilink/bot/get_qrcode_status':{const st=s.qrStates.shift()||'wait';return ok(st==='confirmed'?{status:st,bot_token:'TOKEN',ilink_bot_id:'bot@im.bot',ilink_user_id:'owner@im.wechat',baseurl:'https://api.fake'}:{status:st});}
      case '/ilink/bot/getupdates':{
        if(s.expire)return ok({ret:-14,errcode:-14,errmsg:'session timeout'});
        const msgs=s.updates.shift();
        if(!msgs){await new Promise((r,j)=>{const id=setTimeout(r,20);init.signal?.addEventListener('abort',()=>{clearTimeout(id);j(Object.assign(new Error('aborted'),{name:'AbortError'}));});});return ok({ret:0,msgs:[],get_updates_buf:body.get_updates_buf});}
        return ok({ret:0,msgs,get_updates_buf:'cursor'+s.calls.length});
      }
      case '/ilink/bot/sendmessage':s.sent.push(body.msg);return ok({ret:0});
      case '/ilink/bot/getconfig':return ok({ret:0,typing_ticket:'TICKET'});
      case '/ilink/bot/sendtyping':s.typing.push(body.status);return ok({ret:0});
    }
    return new Response('{}',{status:404});
  };
  return s;
}
const msg=(from,text,ctx='CTX1')=>({message_type:1,from_user_id:from,to_user_id:'bot@im.bot',context_token:ctx,create_time_ms:Date.now(),item_list:[{type:1,text_item:{text}}]});
const until=async(f,ms=2000)=>{const end=Date.now()+ms;while(Date.now()<end){if(f())return true;await new Promise(r=>setTimeout(r,5));}return false;};
const fastSleep=(ms,signal)=>new Promise(r=>{const id=setTimeout(()=>r(true),1);signal?.addEventListener('abort',()=>{clearTimeout(id);r(false);},{once:true});});

test('scanning the QR code connects, saves the token and starts receiving',async()=>{
  const ilink=fakeIlink(),saved=[],statuses=[];
  const c=new WeixinClient({fetchImpl:ilink.fetch,store:{load:()=>null,save:s=>saved.push(s&&{...s})},onStatus:s=>statuses.push(s.state),sleep:fastSleep});
  await c.login();
  assert.deepEqual(statuses.slice(0,3),['qr','scanned','connected']);
  assert.equal(saved.at(-1).token,'TOKEN');assert.equal(saved.at(-1).baseUrl,'https://api.fake');assert.equal(saved.at(-1).userId,'owner@im.wechat');
  assert.equal(ilink.calls.find(x=>x.path==='/ilink/bot/get_qrcode_status').headers['iLink-App-ClientVersion'],'1');
  await until(()=>ilink.calls.some(x=>x.path==='/ilink/bot/getupdates'));
  const poll=ilink.calls.find(x=>x.path==='/ilink/bot/getupdates');
  assert.equal(poll.headers.Authorization,'Bearer TOKEN');assert.equal(poll.headers.AuthorizationType,'ilink_bot_token');
  c.stop();
});
test('only the owner reaches the brain, and replies echo the context token',async()=>{
  const ilink=fakeIlink(),got=[];let state={token:'TOKEN',baseUrl:'https://api.fake',userId:'owner@im.wechat',cursor:'',context:''};
  const c=new WeixinClient({fetchImpl:ilink.fetch,store:{load:()=>state,save:s=>{state=s;}},onMessage:(t,m)=>got.push([t,m.userId]),sleep:fastSleep});
  assert.equal(c.canSend(),false);
  await assert.rejects(c.send('hi'),/先在微信里/);
  ilink.updates.push([msg('stranger@im.wechat','你好'),msg('owner@im.wechat','在吗','CTX9')]);
  c.start();
  await until(()=>got.length>0);
  assert.deepEqual(got,[['在吗','owner@im.wechat']]);
  assert.equal(state.context,'CTX9','context token persisted for later replies');
  await until(()=>state.cursor);assert.ok(state.cursor.startsWith('cursor'));
  assert.equal(await c.typing(true),true);
  await c.send('在呢');
  assert.equal(ilink.sent[0].context_token,'CTX9');assert.equal(ilink.sent[0].to_user_id,'owner@im.wechat');
  assert.equal(ilink.sent[0].item_list[0].text_item.text,'在呢');assert.equal(ilink.sent[0].message_type,2);
  assert.deepEqual(ilink.typing,[1]);
  c.stop();
});
test('an expired session clears the token and reports it',async()=>{
  const ilink=fakeIlink();ilink.expire=true;let state={token:'TOKEN',baseUrl:'https://api.fake',userId:'u',cursor:'',context:'C'};const statuses=[];
  const c=new WeixinClient({fetchImpl:ilink.fetch,store:{load:()=>state,save:s=>{state=s;}},onStatus:s=>statuses.push(s.state),sleep:fastSleep});
  c.start();await until(()=>statuses.includes('expired'));
  assert.equal(state,null);assert.equal(c.connected,false);
});
test('logging out forgets everything',()=>{
  let state={token:'T',baseUrl:'b',userId:'u',cursor:'',context:'c'};
  const c=new WeixinClient({fetchImpl:async()=>{throw Error('no network');},store:{load:()=>state,save:s=>{state=s;}}});
  assert.equal(c.status.state,'connected');
  c.logout();assert.equal(state,null);assert.equal(c.status.state,'off');
});
test('non-text messages become short descriptions',()=>{
  assert.equal(messageText([{type:3,voice_item:{text:'早上好'}}]),'（语音）早上好');
  assert.equal(messageText([{type:2,image_item:{}}]),'（发来一张图片）');
  assert.equal(messageText([{type:1,text_item:{text:'看这个'}},{type:5,video_item:{}}]),'看这个\n（发来一段视频）');
  assert.equal(sessionExpired({code:-14}),true);
  assert.equal(WEIXIN.baseUrl,'https://ilinkai.weixin.qq.com');
});
