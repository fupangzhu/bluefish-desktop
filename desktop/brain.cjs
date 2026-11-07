// Main-process host for the chat brain: settings (API key encrypted with safeStorage),
// the daily token budget, the event file, and the bridge between the brain and the windows.
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');

const DEFAULTS={baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash',cheapModel:'',persona:'',dailyTokens:200000};
const LIMITS={persona:2000,url:300,model:120,key:400};

function createBrainHost({dir,safeStorage,out,log=console.warn,weixinBase=null}){
  const configFile=path.join(dir,'config.json'),usageFile=path.join(dir,'usage.json'),weixinFile=path.join(dir,'weixin.json');
  let config={...DEFAULTS},apiKey='',brain=null,mods=null,weixin=null;
  const readJson=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return null;}};
  const writeJson=(f,v)=>{fs.mkdirSync(dir,{recursive:true});const tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v,null,2));fs.renameSync(tmp,f);};

  function load(){
    const saved=readJson(configFile)||{};
    for(const k of Object.keys(DEFAULTS))if(typeof saved[k]===typeof DEFAULTS[k])config[k]=saved[k];
    apiKey='';
    if(typeof saved.apiKeyEnc==='string'&&saved.apiKeyEnc){
      try{apiKey=safeStorage.decryptString(Buffer.from(saved.apiKeyEnc,'base64'));}catch(e){log('brain: cannot decrypt API key',e.message);}
    }
  }
  function save(){
    const doc={...config};
    if(apiKey){
      if(!safeStorage.isEncryptionAvailable())throw Error('系统加密不可用，无法安全保存 API Key');
      doc.apiKeyEnc=safeStorage.encryptString(apiKey).toString('base64');
    }
    writeJson(configFile,doc);
  }

  // ---- daily budget ----
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;};
  function usage(){const u=readJson(usageFile);return u&&u.day===today()?u:{day:today(),tokens:0,calls:0};}
  const budget={
    exhausted:()=>config.dailyTokens>0&&usage().tokens>=config.dailyTokens,
    spend(tokens){const u=usage();u.tokens+=Math.max(0,Number(tokens)||0);u.calls+=1;try{writeJson(usageFile,u);}catch{}}
  };

  // ---- WeChat credentials: the bot token is encrypted like the API key ----
  const weixinStore={
    load(){
      const s=readJson(weixinFile);if(!s||typeof s.tokenEnc!=='string')return null;
      try{return {...s,token:safeStorage.decryptString(Buffer.from(s.tokenEnc,'base64')),tokenEnc:undefined};}catch(e){log('brain: cannot decrypt WeChat token',e.message);return null;}
    },
    save(state){
      if(!state){try{fs.rmSync(weixinFile,{force:true});}catch{}return;}
      if(!safeStorage.isEncryptionAvailable())throw Error('系统加密不可用，无法安全保存微信凭证');
      const {token,...rest}=state;writeJson(weixinFile,{...rest,tokenEnc:safeStorage.encryptString(token).toString('base64')});
    }
  };
  // Lines for WeChat go out through the WeChat client; the pet still gets told so she can react.
  const routed={
    async say(text,channel){if(channel==='weixin')await weixin.send(text);out.say(text,channel);},
    act:(a,channel)=>out.act(a,channel),
    typing(on,channel){if(channel==='weixin')weixin?.typing(on);out.typing(on,channel);},
    notice:(text,channel,o)=>out.notice(text,'desktop',o),
    state:(name,channel)=>out.state?.(name,channel)
  };

  async function init(){
    load();
    const imp=f=>import(pathToFileURL(path.join(__dirname,'..','src','brain',f)).href);
    const [b,ev,llm,wx]=await Promise.all([imp('brain.mjs'),imp('events.mjs'),imp('llm.mjs'),imp('weixin.mjs')]);
    mods={llm};
    const store=new ev.EventStore(path.join(dir,'events.jsonl'));
    const call=async({role,messages,tools,signal,temperature,maxTokens})=>{
      const model=role==='cheap'&&config.cheapModel?config.cheapModel:config.model;
      const res=await llm.chat({baseUrl:config.baseUrl,apiKey,model,messages,tools,signal,temperature,maxTokens});
      budget.spend(res.usage?.total_tokens||0);
      return res;
    };
    brain=new b.Brain({llm:call,store,out:routed,budget,persona:()=>config.persona.trim(),log});
    weixin=new wx.WeixinClient({store:weixinStore,log,loginBase:weixinBase||wx.WEIXIN.baseUrl,
      onMessage:text=>{out.incoming?.('weixin');brain.receive(text,'weixin');},
      onStatus:s=>{out.weixinStatus?.(s);if(s.state==='expired')out.notice('微信连接过期了，需要重新扫码。','desktop',{settings:true});}});
    weixin.start();
    return api;
  }

  function settings(){
    return {...config,hasKey:!!apiKey,encryption:safeStorage.isEncryptionAvailable(),usage:usage()};
  }
  function update(patch){
    if(!patch||typeof patch!=='object')return settings();
    const str=(v,max)=>typeof v==='string'?v.trim().slice(0,max):undefined;
    const url=str(patch.baseUrl,LIMITS.url);
    if(url!==undefined){if(url&&!/^https?:\/\//i.test(url))throw Error('接口地址要以 http:// 或 https:// 开头');config.baseUrl=url||DEFAULTS.baseUrl;}
    const model=str(patch.model,LIMITS.model);if(model!==undefined)config.model=model||DEFAULTS.model;
    const cheap=str(patch.cheapModel,LIMITS.model);if(cheap!==undefined)config.cheapModel=cheap;
    if(typeof patch.persona==='string')config.persona=patch.persona.slice(0,LIMITS.persona);
    if(Number.isFinite(patch.dailyTokens))config.dailyTokens=Math.max(0,Math.min(5e6,Math.round(patch.dailyTokens)));
    const key=str(patch.apiKey,LIMITS.key);if(key)apiKey=key;
    if(patch.clearKey===true)apiKey='';
    save();
    return settings();
  }
  async function models(patch){
    const base=typeof patch?.baseUrl==='string'&&patch.baseUrl.trim()?patch.baseUrl.trim():config.baseUrl;
    const key=typeof patch?.apiKey==='string'&&patch.apiKey.trim()?patch.apiKey.trim():apiKey;
    return mods.llm.listModels({baseUrl:base,apiKey:key});
  }
  const api={
    init,settings,update,models,
    defaults:async()=>{const p=await import(pathToFileURL(path.join(__dirname,'..','src','brain','prompts.mjs')).href);return {persona:p.DEFAULT_PERSONA};},
    receive:(text,channel)=>brain?.receive(text,channel),
    typing:()=>brain?.typing(),
    history:n=>brain?brain.store.recent(n).filter(e=>e.type==='heard'||e.type==='said'):[],
    weixinStatus:()=>weixin?{...weixin.status,canSend:weixin.canSend()}:{state:'off'},
    // Resolves once the QR flow ends (connected, cancelled or failed); progress comes via weixinStatus.
    weixinConnect:()=>{weixin.login().catch(e=>log('weixin login failed',e.message));return weixin.status;},
    weixinCancel:()=>{weixin?.cancelLogin();return weixin?.status;},
    weixinDisconnect:()=>{weixin?.logout();return weixin?.status;},
    stop:()=>{brain?.stop();weixin?.stop();weixin?.cancelLogin();}
  };
  return api;
}
module.exports={createBrainHost,DEFAULTS};
