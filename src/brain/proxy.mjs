// Backward-compatible HTTP(S) proxy for the chat brain, built on node:http/https + CONNECT.
// The brain calls OpenAI-compatible endpoints and the WeChat iLink API with the built-in fetch,
// which ignores the system proxy; this wraps it so a configured proxy tunnels both.
//
// The response is only as complete as the brain needs: ok / status / text() / json().
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

export const PROXY={connectTimeoutMs:15000};

// Accepts "127.0.0.1:7897", "http://user:pass@host:7897", "https://host:443".
export function parseProxy(raw){
  const text=String(raw??'').trim();
  if(!text)return null;
  const withScheme=/^[a-z][a-z0-9+.-]*:\/\//i.test(text)?text:'http://'+text;
  let url;try{url=new URL(withScheme);}catch{throw Error('代理地址看不懂，示例：http://127.0.0.1:7897');}
  if(url.protocol!=='http:'&&url.protocol!=='https:')throw Error('代理只支持 http:// 或 https://');
  if(!url.hostname)throw Error('代理地址缺少主机名');
  const secure=url.protocol==='https:';
  return {protocol:url.protocol,host:url.hostname,port:Number(url.port)||(secure?443:80),secure,
    auth:url.username?decodeURIComponent(url.username)+':'+decodeURIComponent(url.password):'',
    label:`${url.protocol}//${url.host}`};
}

function proxyAuthHeader(auth){return auth?'Basic '+Buffer.from(auth,'utf8').toString('base64'):'';}

// Opens a CONNECT tunnel; resolves with the raw socket to the target.
function tunnel(proxy,target,{signal}={}){
  const connectHost=target;
  return new Promise((resolve,reject)=>{
    const lib=proxy.secure?https:http;
    const headers={Host:connectHost};
    if(proxy.auth)headers['Proxy-Authorization']=proxyAuthHeader(proxy.auth);
    const req=lib.request({host:proxy.host,port:proxy.port,method:'CONNECT',path:connectHost,headers,timeout:PROXY.connectTimeoutMs});
    const done=(fn,arg)=>{signal?.removeEventListener('abort',onAbort);fn(arg);};
    const onAbort=()=>{req.destroy();done(reject,signal?.reason instanceof Error?signal.reason:Error('已取消'));};
    signal?.addEventListener('abort',onAbort,{once:true});
    req.once('connect',(res,socket)=>{
      if(res.statusCode!==200){socket.destroy();done(reject,Error(`代理拒绝连接（HTTP ${res.statusCode}）`));return;}
      socket.setNoDelay(true);
      done(resolve,socket);
    });
    req.once('timeout',()=>req.destroy(Error(`连接代理超时（${proxy.label}）`)));
    req.once('error',err=>done(reject,Error(`连不上代理 ${proxy.label}：${err.message}`)));
    req.end();
  });
}

function readBody(res){
  return new Promise((resolve,reject)=>{
    const chunks=[];
    res.on('data',c=>chunks.push(c));
    res.once('end',()=>resolve(Buffer.concat(chunks)));
    res.once('error',reject);
  });
}

async function requestThrough(proxy,url,init={}){
  const target=new URL(String(url));
  const secure=target.protocol==='https:';
  if(target.protocol!=='http:'&&target.protocol!=='https:')throw Error('只支持 http:// 或 https:// 地址');
  const port=Number(target.port)||(secure?443:80);
  const socket=await tunnel(proxy,`${target.hostname}:${port}`,{signal:init.signal});
  const headers={...init.headers,Host:target.host};
  return new Promise((resolve,reject)=>{
    const lib=secure?https:http;
    const req=lib.request({
      method:init.method||'GET',
      path:target.pathname+target.search,
      headers,
      createConnection:()=>secure?tls.connect({socket,servername:target.hostname}):socket
    },async res=>{
      try{
        const body=await readBody(res);
        resolve({
          ok:res.statusCode>=200&&res.statusCode<300,
          status:res.statusCode,
          statusText:res.statusMessage||'',
          headers:res.headers,
          url:String(url),
          text:async()=>body.toString('utf8'),
          json:async()=>JSON.parse(body.toString('utf8')),
          arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)
        });
      }catch(err){reject(err);}
    });
    const onAbort=()=>{req.destroy();reject(init.signal?.reason instanceof Error?init.signal.reason:Error('已取消'));};
    init.signal?.addEventListener('abort',onAbort,{once:true});
    req.once('error',err=>{init.signal?.removeEventListener('abort',onAbort);reject(Error(`代理请求失败：${err.message}`));});
    if(init.body!==undefined&&init.body!==null)req.write(init.body);
    req.end();
  });
}

// fetch with the same call shape as the global one. makeFetch('') returns the global fetch.
export function makeFetch(proxy){
  const parsed=typeof proxy==='string'||proxy===null||proxy===undefined?parseProxy(proxy):proxy;
  if(!parsed)return fetch;
  return (url,init)=>requestThrough(parsed,url,init);
}
