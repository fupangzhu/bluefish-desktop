// Chat bubble above the pet: her lines, the owner's input, and the model settings.
import {hydrate} from './icons.mjs';
hydrate();
const $=s=>document.querySelector(s);
const card=$('#card'),log=$('#log'),typingEl=$('#typing'),composer=$('#composer'),input=$('#text'),gear=$('#gear'),panel=$('#settings'),errorEl=$('#settingsError');
const fields={baseUrl:$('#baseUrl'),apiKey:$('#apiKey'),model:$('#model'),persona:$('#persona'),dailyTokens:$('#dailyTokens')};
// Without the Electron bridge (plain browser preview) the bubble still renders against a stub.
const api=window.bubble||{send(t){addLine({who:'me',text:t});setTimeout(()=>addLine({who:'her',text:'（预览模式，没有连接大脑）'}),400);},typing(){},close(){},fit(){},
  settings:async()=>({baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash',persona:'',dailyTokens:200000,hasKey:false,usage:{tokens:0}}),
  save:async p=>p,models:async()=>[],defaults:async()=>({persona:''}),history:async()=>[],onLine(){},onTyping(){},onMode(){}};
const MAX_LINES=8;
let mode='chat',defaultPersona='';

function addLine({who,text,settings}){
  const el=document.createElement('div');el.className='line '+who;el.textContent=text;
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
    fields.baseUrl.value=s.baseUrl||'';fields.model.value=s.model||'';fields.persona.value=s.persona||defaultPersona;fields.dailyTokens.value=s.dailyTokens??200000;
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
    const list=await api.models({baseUrl:fields.baseUrl.value,apiKey:fields.apiKey.value});
    if(list?.error)throw Error(list.error);
    const dl=$('#modelList');dl.replaceChildren(...list.map(id=>{const o=document.createElement('option');o.value=id;return o;}));
    showError(list.length?'':'接口没有返回模型');if(list.length)$('#usage').textContent=`可用模型：${list.join('、')}`;fit();
  }catch(err){showError(err.message||String(err));}
});
$('#save').addEventListener('click',async()=>{
  showError('');
  const persona=fields.persona.value.trim();
  const patch={baseUrl:fields.baseUrl.value,model:fields.model.value,persona:persona===defaultPersona.trim()?'':persona,dailyTokens:Number(fields.dailyTokens.value)};
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

api.onLine(addLine);
api.onTyping(on=>{typingEl.hidden=!on;if(on)log.scrollTop=log.scrollHeight;fit();});
api.onMode(setMode);
defaultPersona=(await api.defaults()).persona||'';
for(const e of (await api.history()).slice(-4))addLine({who:e.type==='heard'?'me':'her',text:e.text});
fit();
