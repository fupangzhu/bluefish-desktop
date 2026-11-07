// WeChat channel over Tencent's official "WeChat ClawBot" iLink Bot API.
// The owner scans a QR code with their own WeChat; only that person's messages reach the brain.
// Protocol notes: refs/weixin-bot/docs/protocol-spec.md (QR login, long-poll getupdates,
// sendmessage echoing context_token, getconfig + sendtyping, errcode -14 = session expired).
import crypto from 'node:crypto';

export const WEIXIN={baseUrl:'https://ilinkai.weixin.qq.com',channelVersion:'1.0.0',qrPollMs:2000,pollTimeoutMs:40000,sendTimeoutMs:15000,retryMin:1000,retryMax:30000,maxText:2000};
const USER=1,BOT=2,FINISH=2,TEXT=1,IMAGE=2,VOICE=3,FILE=4,VIDEO=5;

export class WeixinError extends Error{constructor(message,{status=0,code=null}={}){super(message);this.status=status;this.code=code;}}
export const sessionExpired=e=>e?.code===-14;

const trim=u=>String(u||'').replace(/\/+$/,'');
const uin=()=>Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)),'utf8').toString('base64');

// Text the brain should see for one inbound message.
export function messageText(items=[]){
  return items.map(it=>{
    switch(it?.type){
      case TEXT:return it.text_item?.text||'';
      case VOICE:return it.voice_item?.text?`（语音）${it.voice_item.text}`:'（发来一段语音）';
      case IMAGE:return '（发来一张图片）';
      case FILE:return `（发来一个文件${it.file_item?.file_name?'：'+it.file_item.file_name:''}）`;
      case VIDEO:return '（发来一段视频）';
      default:return '';
    }
  }).filter(Boolean).join('\n').trim();
}

export class WeixinClient{
  // store: {load()->state|null, save(state)} — state holds the bot token; the caller encrypts it.
  // onMessage(text,{userId,at}), onStatus(status), log(...)
  constructor({fetchImpl=fetch,store,onMessage=()=>{},onStatus=()=>{},log=()=>{},loginBase=WEIXIN.baseUrl,sleep=null}={}){
    Object.assign(this,{fetchImpl,store,onMessage,onStatus,log,loginBase});
    this.sleep=sleep||((ms,signal)=>new Promise(r=>{const id=setTimeout(()=>r(true),ms);signal?.addEventListener('abort',()=>{clearTimeout(id);r(false);},{once:true});}));
    this.state=store?.load?.()||null;   // {token,baseUrl,botId,userId,cursor,context}
    this.status=this.state?.token?{state:'connected',userId:this.state.userId}:{state:'off'};
    this.loop=null;this.abort=null;this.loginAbort=null;this.ticket=null;
  }
  get connected(){return !!this.state?.token;}
  setStatus(s){this.status=s;this.onStatus(s);}
  persist(){this.store?.save?.(this.state);}

  async request(path,{method='POST',body,token,base,timeoutMs=WEIXIN.sendTimeoutMs,signal,headers={}}={}){
    const url=trim(base||this.state?.baseUrl||this.loginBase)+path;
    const t=AbortSignal.timeout(timeoutMs),sig=signal?AbortSignal.any([signal,t]):t;
    const h={...headers};
    if(method==='POST'){Object.assign(h,{'Content-Type':'application/json',AuthorizationType:'ilink_bot_token','X-WECHAT-UIN':uin()});if(token)h.Authorization='Bearer '+token;}
    const res=await this.fetchImpl(url,{method,headers:h,body:method==='POST'?JSON.stringify(body??{}):undefined,signal:sig});
    const text=await res.text();let json={};
    try{json=text?JSON.parse(text):{};}catch{throw new WeixinError(`微信接口返回的不是 JSON（${res.status}）`,{status:res.status});}
    if(!res.ok)throw new WeixinError(json.errmsg||`微信接口 HTTP ${res.status}`,{status:res.status,code:json.errcode??null});
    if(typeof json.ret==='number'&&json.ret!==0)throw new WeixinError(json.errmsg||`微信接口失败（${json.ret}）`,{status:res.status,code:json.errcode??json.ret});
    if(typeof json.errcode==='number'&&json.errcode!==0)throw new WeixinError(json.errmsg||`微信接口失败（${json.errcode}）`,{status:res.status,code:json.errcode});
    return json;
  }

  // ---- login ----
  // Shows a QR (status {state:'qr',url}), follows it to confirmation, then starts receiving.
  async login(){
    this.cancelLogin();
    const ac=new AbortController();this.loginAbort=ac;
    try{
      while(!ac.signal.aborted){
        const qr=await this.request('/ilink/bot/get_bot_qrcode?bot_type=3',{method:'GET',base:this.loginBase,signal:ac.signal});
        if(!qr.qrcode||!qr.qrcode_img_content)throw new WeixinError('没拿到登录二维码');
        this.setStatus({state:'qr',url:qr.qrcode_img_content});
        let last='wait';
        while(!ac.signal.aborted){
          const s=await this.request(`/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}`,{method:'GET',base:this.loginBase,signal:ac.signal,headers:{'iLink-App-ClientVersion':'1'},timeoutMs:WEIXIN.pollTimeoutMs});
          if(s.status==='scaned'&&last!=='scaned'){last='scaned';this.setStatus({state:'scanned',url:qr.qrcode_img_content});}
          if(s.status==='confirmed'){
            if(!s.bot_token||!s.ilink_user_id)throw new WeixinError('扫码确认了，但没有拿到机器人凭证');
            this.state={token:s.bot_token,baseUrl:trim(s.baseurl||this.loginBase),botId:s.ilink_bot_id||'',userId:s.ilink_user_id,cursor:'',context:'',contextAt:0};
            this.persist();this.setStatus({state:'connected',userId:this.state.userId});
            this.start();return this.status;
          }
          if(s.status==='expired')break;
          if(!await this.sleep(WEIXIN.qrPollMs,ac.signal))break;
        }
      }
      return this.status;
    }catch(e){
      if(ac.signal.aborted)return this.status;
      this.setStatus({state:'error',message:e.message});throw e;
    }finally{if(this.loginAbort===ac)this.loginAbort=null;}
  }
  cancelLogin(){this.loginAbort?.abort();this.loginAbort=null;if(this.status.state==='qr'||this.status.state==='scanned')this.setStatus(this.connected?{state:'connected',userId:this.state.userId}:{state:'off'});}
  logout(){this.cancelLogin();this.stop();this.state=null;this.ticket=null;this.store?.save?.(null);this.setStatus({state:'off'});}

  // ---- receiving ----
  start(){if(!this.connected||this.loop)return;this.stopped=false;this.loop=this.run().finally(()=>{this.loop=null;});}
  stop(){this.stopped=true;this.abort?.abort();}
  async run(){
    let wait=WEIXIN.retryMin;
    while(!this.stopped&&this.connected){
      const ac=new AbortController();this.abort=ac;
      try{
        const r=await this.request('/ilink/bot/getupdates',{token:this.state.token,body:{get_updates_buf:this.state.cursor||'',base_info:{channel_version:WEIXIN.channelVersion}},timeoutMs:WEIXIN.pollTimeoutMs+5000,signal:ac.signal});
        wait=WEIXIN.retryMin;
        if(this.status.state!=='connected')this.setStatus({state:'connected',userId:this.state.userId});
        for(const m of r.msgs||[])this.handle(m);
        if(r.get_updates_buf&&r.get_updates_buf!==this.state.cursor){this.state.cursor=r.get_updates_buf;this.persist();}
      }catch(e){
        if(this.stopped)break;
        if(sessionExpired(e)){this.log('weixin session expired');this.state=null;this.store?.save?.(null);this.setStatus({state:'expired'});break;}
        if(e?.name==='TimeoutError'||e?.name==='AbortError'){continue;}
        this.log('weixin poll failed',e.message);
        this.setStatus({state:'retrying',message:e.message,userId:this.state?.userId});
        await this.sleep(wait);wait=Math.min(wait*2,WEIXIN.retryMax);
      }finally{if(this.abort===ac)this.abort=null;}
    }
  }
  handle(m){
    if(m?.message_type!==USER)return;
    // Only the person who scanned the code is the owner.
    if(m.from_user_id!==this.state.userId){this.log('weixin: ignored a message from someone else');return;}
    if(m.context_token&&m.context_token!==this.state.context){this.state.context=m.context_token;this.state.contextAt=Date.now();this.ticket=null;this.persist();}
    const text=messageText(m.item_list);
    if(text)this.onMessage(text,{userId:m.from_user_id,at:m.create_time_ms||Date.now()});
  }

  // ---- sending ----
  canSend(){return this.connected&&!!this.state.context;}
  async send(text){
    if(!this.canSend())throw new WeixinError('还没有可用的微信会话：要先在微信里给她发一句话');
    const chars=[...String(text)];
    for(let i=0;i<chars.length;i+=WEIXIN.maxText){
      await this.request('/ilink/bot/sendmessage',{token:this.state.token,body:{msg:{from_user_id:'',to_user_id:this.state.userId,client_id:crypto.randomUUID(),message_type:BOT,message_state:FINISH,context_token:this.state.context,item_list:[{type:TEXT,text_item:{text:chars.slice(i,i+WEIXIN.maxText).join('')}}]},base_info:{channel_version:WEIXIN.channelVersion}}});
    }
  }
  // "对方正在输入中". Best effort: failures never block a reply.
  async typing(on){
    if(!this.canSend())return false;
    try{
      if(!this.ticket){
        const c=await this.request('/ilink/bot/getconfig',{token:this.state.token,body:{ilink_user_id:this.state.userId,context_token:this.state.context,base_info:{channel_version:WEIXIN.channelVersion}}});
        this.ticket=c.typing_ticket||null;
      }
      if(!this.ticket)return false;
      await this.request('/ilink/bot/sendtyping',{token:this.state.token,body:{ilink_user_id:this.state.userId,typing_ticket:this.ticket,status:on?1:2,base_info:{channel_version:WEIXIN.channelVersion}}});
      return true;
    }catch(e){this.log('weixin typing failed',e.message);if(sessionExpired(e))this.ticket=null;return false;}
  }
}
