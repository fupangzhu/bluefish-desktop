// Chat bubble above the pet: her lines, the owner's input, the model settings and the WeChat link.
import {hydrate} from './icons.mjs';
import {qrSvg} from './qr.mjs';
hydrate();
const $=s=>document.querySelector(s);
const card=$('#card'),log=$('#log'),typingEl=$('#typing'),composer=$('#composer'),input=$('#text'),gear=$('#gear'),panel=$('#settings'),errorEl=$('#settingsError');
const fields={baseUrl:$('#baseUrl'),proxy:$('#proxy'),apiKey:$('#apiKey'),model:$('#model'),persona:$('#persona'),dailyTokens:$('#dailyTokens')};
// Without the Electron bridge (plain browser preview) the bubble still renders against a stub.
const api=window.bubble||{send(t){addLine({who:'me',text:t});setTimeout(()=>addLine({who:'her',text:'（预览模式，没有连接大脑）'}),400);},typing(){},close(){},fit(){},
  settings:async()=>({baseUrl:'https://api.deepseek.com',proxy:'',model:'deepseek-v4-flash',persona:'',dailyTokens:200000,hasKey:false,usage:{tokens:0}}),
  save:async p=>p,models:async()=>[],defaults:async()=>({persona:''}),history:async()=>[],onLine(){},onTyping(){},onMode(){}};
const MAX_LINES=8;
let mode='chat',defaultPersona='';

const CHANNEL_LABEL={weixin:'微信',qq:'QQ'};
function addLine({who,text,settings,channel}){
  const el=document.createElement('div');
  const from=who==='notice'?'':(CHANNEL_LABEL[channel]||(channel&&channel!=='desktop'?channel:''));
  el.className='line '+who+(from?' other':'');
  if(from){const tag=document.createElement('span');tag.className='from';tag.textContent=from;el.append(tag);}
  el.append(document.createTextNode(text));
  if(who==='notice'&&settings){const b=document.createElement('button');b.type='button';b.textContent='打开设置';b.addEventListener('click',()=>showSettings(true));el.append(' ',b);}
  log.append(el);
  while(log.children.length>MAX_LINES)log.firstElementChild.remove();
  log.scrollTop=log.scrollHeight;fit();
}
function setMode(next){
  mode=next.mode||'chat';
  composer.hidden=mode!=='chat';
  if(next.settings)showSettings(true);
  if(mode==='chat'){card.classList.remove('replay');void card.offsetWidth;setTimeout(()=>input.focus(),30);}
  fit();
}
async function showSettings(on){
  panel.hidden=!on;gear.setAttribute('aria-pressed',String(on));errorEl.hidden=true;
  if(on){
    const s=await api.settings();
    fields.baseUrl.value=s.baseUrl||'';fields.proxy.value=s.proxy||'';fields.model.value=s.model||'';fields.persona.value=s.persona||defaultPersona;fields.dailyTokens.value=s.dailyTokens??200000;
    fields.apiKey.value='';fields.apiKey.placeholder=s.hasKey?'已保存（留空不改）':'sk-...';
    $('#usage').textContent=`今天已用 ${s.usage?.tokens??0} token`+(s.encryption===false?' · 系统加密不可用，无法保存密钥':'');
  }
  fit();
}
function showError(msg){errorEl.textContent=msg;errorEl.hidden=!msg;fit();}

composer.addEventListener('submit',e=>{
  e.preventDefault();const text=input.value.trim();if(!text)return;
  addLine({who:'me',text});api.send(text);input.value='';
});
let typingSent=0;
input.addEventListener('input',()=>{const now=Date.now();if(now-typingSent>1000){typingSent=now;api.typing();}});
gear.addEventListener('click',()=>showSettings(panel.hidden));
$('#resetPersona').addEventListener('click',()=>{fields.persona.value=defaultPersona;});
$('#fetchModels').addEventListener('click',async()=>{
  showError('');
  try{
    const list=await api.models({baseUrl:fields.baseUrl.value,apiKey:fields.apiKey.value,proxy:fields.proxy.value});
    if(list?.error)throw Error(list.error);
    const dl=$('#modelList');dl.replaceChildren(...list.map(id=>{const o=document.createElement('option');o.value=id;return o;}));
    showError(list.length?'':'接口没有返回模型');if(list.length)$('#usage').textContent=`可用模型：${list.join('、')}`;fit();
  }catch(err){showError(err.message||String(err));}
});
$('#save').addEventListener('click',async()=>{
  showError('');
  const persona=fields.persona.value.trim();
  const patch={baseUrl:fields.baseUrl.value,proxy:fields.proxy.value,model:fields.model.value,persona:persona===defaultPersona.trim()?'':persona,dailyTokens:Number(fields.dailyTokens.value)};
  if(fields.apiKey.value.trim())patch.apiKey=fields.apiKey.value.trim();
  const r=await api.save(patch);
  if(r?.error)return showError(r.error);
  showSettings(false);addLine({who:'notice',text:'设置已保存'});input.focus();
});
addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(!panel.hidden)showSettings(false);else api.close();}});
// Enter in a one-line settings field saves, like a form would.
panel.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();$('#save').click();}});

let lastFit=0;
function fit(){const h=Math.ceil(document.querySelector('.wrap').getBoundingClientRect().height);if(h!==lastFit){lastFit=h;api.fit(h);}}
new ResizeObserver(fit).observe(card);

// ---- WeChat ----
const wx=api.weixin||{status:async()=>({state:'off'}),connect:async()=>({state:'off'}),cancel:async()=>({}),disconnect:async()=>({}),onStatus(){}};
const wxStatus=$('#wxStatus'),wxButton=$('#wxButton'),qrBox=$('#qr'),wxHint=$('#wxHint');
let wxState='off',qrUrl='';
const WX_TEXT={off:'未连接',qr:'等待扫码',scanned:'已扫码，请在手机上确认',connected:'已连接',retrying:'连接不稳，正在重试',expired:'连接过期了，请重新扫码',error:'连接失败'};
function renderWeixin(s){
  if(!s)return;
  wxState=s.state||'off';
  wxStatus.textContent=WX_TEXT[wxState]||wxState;
  const showQr=(wxState==='qr'||wxState==='scanned')&&s.url;
  if(showQr&&s.url!==qrUrl){qrUrl=s.url;qrBox.innerHTML=qrSvg(s.url);}
  qrBox.hidden=!showQr;
  wxButton.textContent=showQr?'取消':wxState==='connected'||wxState==='retrying'?'断开':'连接微信';
  const hint=showQr?(wxState==='scanned'?'在手机微信里点确认。':'用你自己的微信扫一扫。这是腾讯官方的 ClawBot 接口，不需要小号。')
    :wxState==='connected'&&s.canSend===false?'连上了。先在微信里给她发一句话，她才能回你。'
    :wxState==='error'&&s.message?s.message:'';
  wxHint.textContent=hint;wxHint.hidden=!hint;
  fit();
}
wxButton.addEventListener('click',async()=>{
  const r=wxState==='qr'||wxState==='scanned'?await wx.cancel():wxState==='connected'||wxState==='retrying'?await wx.disconnect():await wx.connect();
  // Progress arrives through onStatus; the reply itself may already be stale.
  if(r?.error){wxHint.textContent=r.error;wxHint.hidden=false;fit();}
});
wx.onStatus(renderWeixin);
renderWeixin(await wx.status());

// ---- sites (scan-code login) ----
// The login page opens as its own window (native QR size); the bubble only reports the state.
const site=api.site||{status:async()=>({state:'off'}),login:async()=>({}),logout:async()=>({}),onStatus(){}};
const SITE_ID='bilibili';
const SITE_TEXT={off:'未登录',waiting:'等待扫码',connected:'已登录',timeout:'扫码超时',error:'登录失败'};
const siteStatus=$('#siteStatus'),siteButton=$('#siteButton'),siteHint=$('#siteHint');
let siteState='off';
function renderSite(s){
  if(!s)return;
  siteState=s.state||'off';
  siteStatus.textContent=SITE_TEXT[siteState]||siteState;
  siteButton.textContent=siteState==='connected'?'退出登录':siteState==='waiting'?'取消':'扫码登录';
  const hint=siteState==='waiting'?'在弹出的窗口里用手机扫码；扫完窗口会自己关掉。'
    :siteState==='connected'?'已登录。之后她可以在你允许的范围内只读地看内容。'
    :siteState==='timeout'?'这次没扫上，再点一次就行。'
    :siteState==='error'&&s.message?s.message:'';
  siteHint.textContent=hint;siteHint.hidden=!hint;
  fit();
}
siteButton.addEventListener('click',async()=>{
  const r=siteState==='connected'||siteState==='waiting'?await site.logout(SITE_ID):await site.login(SITE_ID);
  if(r?.error){siteHint.textContent=r.error;siteHint.hidden=false;fit();}
});
site.onStatus(s=>{if(!s||!s.key||s.key===SITE_ID)renderSite(s);});
// Not awaited: the page must finish loading even if the main process is slow to answer.
site.status(SITE_ID).then(renderSite).catch(()=>{});

api.onLine(addLine);
api.onTyping(on=>{typingEl.hidden=!on;if(on)log.scrollTop=log.scrollHeight;fit();});
api.onMode(setMode);
defaultPersona=(await api.defaults()).persona||'';
for(const e of (await api.history()).slice(-6))addLine({who:e.type==='heard'?'me':'her',text:e.text,channel:e.channel});
fit();
