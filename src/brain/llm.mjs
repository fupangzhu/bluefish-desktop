// Minimal OpenAI-compatible chat client (DeepSeek, Qwen, Ollama ...). Uses the built-in fetch.
export class LlmError extends Error{constructor(message,{status=0,kind='request'}={}){super(message);this.status=status;this.kind=kind;}}

const trimBase=url=>String(url||'').trim().replace(/\/+$/,'');

export function parseArgs(raw){
  if(raw&&typeof raw==='object')return raw;
  try{const v=JSON.parse(String(raw||'{}'));return v&&typeof v==='object'?v:{};}catch{return {};}
}

export function readChoice(json){
  const msg=json?.choices?.[0]?.message||{};
  const toolCalls=(msg.tool_calls||[]).map((c,i)=>({id:c.id||`call_${i}`,name:c.function?.name||'',args:parseArgs(c.function?.arguments),raw:c}));
  return {content:typeof msg.content==='string'?msg.content:'',toolCalls,message:msg,usage:json?.usage||null};
}

export async function chat({baseUrl,apiKey,model,messages,tools,temperature=.8,maxTokens=800,signal,timeoutMs=60000,fetchImpl=fetch,thinking=null}){
  if(!trimBase(baseUrl))throw new LlmError('还没有填模型接口地址',{kind:'config'});
  if(!apiKey)throw new LlmError('还没有填 API Key',{kind:'config'});
  if(!model)throw new LlmError('还没有选模型',{kind:'config'});
  const body={model,messages,temperature,max_tokens:maxTokens};
  if(tools?.length){body.tools=tools;body.tool_choice='auto';}
  // Thinking is on by default at high effort; an answer-only call (or a short chat line) can switch
  // it off, which otherwise eats the whole max_tokens budget on reasoning_content.
  if(thinking)body.thinking=thinking;
  const timeout=AbortSignal.timeout(timeoutMs),both=signal?AbortSignal.any([signal,timeout]):timeout;
  let res;
  try{
    res=await fetchImpl(trimBase(baseUrl)+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify(body),signal:both});
  }catch(e){
    if(signal?.aborted)throw new LlmError('已取消',{kind:'aborted'});
    const cause=e?.cause?.code||e?.cause?.message||'';
    throw new LlmError(timeout.aborted?'模型接口超时':`连不上模型接口：${e?.message||e}${cause?'（'+cause+'）':''}`,{kind:'network'});
  }
  const text=await res.text();
  if(!res.ok){
    let msg=text.slice(0,200);try{msg=JSON.parse(text)?.error?.message||msg;}catch{}
    throw new LlmError(`模型接口返回 ${res.status}：${msg}`,{status:res.status,kind:res.status===401||res.status===403?'auth':'http'});
  }
  try{return readChoice(JSON.parse(text));}catch{throw new LlmError('模型接口返回的不是 JSON',{kind:'http'});}
}

export async function listModels({baseUrl,apiKey,fetchImpl=fetch,timeoutMs=15000}){
  if(!trimBase(baseUrl)||!apiKey)throw new LlmError('先填接口地址和 API Key',{kind:'config'});
  const res=await fetchImpl(trimBase(baseUrl)+'/models',{headers:{Authorization:'Bearer '+apiKey},signal:AbortSignal.timeout(timeoutMs)});
  if(!res.ok)throw new LlmError(`获取模型列表失败：${res.status}`,{status:res.status,kind:res.status===401?'auth':'http'});
  const json=await res.json();
  return (json?.data||[]).map(m=>m.id).filter(Boolean).sort();
}
