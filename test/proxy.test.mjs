import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {parseProxy,makeFetch} from '../src/brain/proxy.mjs';

// A CONNECT-capable proxy in front of a plain HTTP origin. Only the very small subset the brain
// uses is covered: CONNECT, absolute origin-form requests and whole-body responses.
function listen(server){
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
}

async function origin(){
  const seen=[];
  const server=http.createServer((req,res)=>{
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      seen.push({method:req.method,url:req.url,headers:req.headers,body});
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true,path:req.url,echo:body}));
    });
  });
  const port=await listen(server);
  return {port,seen,close:()=>server.close()};
}

async function proxy({requireAuth=null,status=200}={}){
  const state={connects:[],auth:[]};
  const server=http.createServer();
  server.on('connect',(req,client,head)=>{
    state.connects.push(req.url);
    state.auth.push(req.headers['proxy-authorization']||'');
    if(status!==200){client.end(`HTTP/1.1 ${status} Nope\r\nContent-Length: 0\r\n\r\n`);return;}
    if(requireAuth&&req.headers['proxy-authorization']!==requireAuth){client.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');return;}
    const [host,port]=req.url.split(':');
    const upstream=net.connect(Number(port),host,()=>{
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(head?.length)upstream.write(head);
      upstream.pipe(client);client.pipe(upstream);
    });
    upstream.on('error',()=>client.destroy());
    client.on('error',()=>upstream.destroy());
  });
  const port=await listen(server);
  return {port,state,close:()=>server.close()};
}

test('parseProxy accepts host:port, schemes and credentials, and rejects nonsense',()=>{
  assert.equal(parseProxy(''),null);
  assert.equal(parseProxy(null),null);
  const a=parseProxy('127.0.0.1:7897');
  assert.equal(a.host,'127.0.0.1');assert.equal(a.port,7897);assert.equal(a.secure,false);assert.equal(a.auth,'');
  const b=parseProxy('http://user:p%40ss@proxy.local:3128');
  assert.equal(b.auth,'user:p@ss');assert.equal(b.port,3128);assert.equal(b.label,'http://proxy.local:3128');
  const c=parseProxy('https://secure.local:8443');
  assert.equal(c.secure,true);assert.equal(c.port,8443);
  assert.throws(()=>parseProxy('ftp://x'),/只支持/);
  assert.throws(()=>parseProxy('http://'),/代理地址看不懂/);
});

test('no proxy keeps the global fetch',()=>{
  assert.equal(makeFetch(''),fetch);
  assert.equal(makeFetch(null),fetch);
});

test('a request goes through the proxy to the origin with its body and headers',async()=>{
  const o=await origin(),p=await proxy();
  const f=makeFetch(`127.0.0.1:${p.port}`);
  const res=await f(`http://127.0.0.1:${o.port}/v1/chat/completions`,{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer local'},
    body:JSON.stringify({model:'m',messages:[]})
  });
  assert.equal(res.ok,true);assert.equal(res.status,200);
  const json=await res.json();
  assert.equal(json.path,'/v1/chat/completions');
  assert.equal(JSON.parse(json.echo).model,'m');
  const seen=o.seen.at(-1);
  assert.equal(seen.method,'POST');
  assert.equal(seen.headers.authorization,'Bearer local');
  assert.equal(seen.headers.host,`127.0.0.1:${o.port}`);
  assert.deepEqual(p.state.connects,[`127.0.0.1:${o.port}`]);
  o.close();p.close();
});

test('proxy credentials are sent as Proxy-Authorization',async()=>{
  const want='Basic '+Buffer.from('user:pass','utf8').toString('base64');
  const o=await origin(),p=await proxy({requireAuth:want});
  const f=makeFetch(`http://user:pass@127.0.0.1:${p.port}`);
  const res=await f(`http://127.0.0.1:${o.port}/v1/models`);
  assert.equal(res.status,200);
  assert.equal(p.state.auth[0],want);
  o.close();p.close();
});

test('a proxy that refuses the tunnel becomes a readable error',async()=>{
  const p=await proxy({status:407});
  const f=makeFetch(`127.0.0.1:${p.port}`);
  await assert.rejects(f('http://example.invalid/v1/models'),/代理拒绝连接（HTTP 407）/);
  p.close();
});

test('an unreachable proxy names itself in the error',async()=>{
  // Grab a free port, then close it so nothing is listening there.
  const probe=net.createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));
  const f=makeFetch(`127.0.0.1:${port}`);
  await assert.rejects(f('http://example.invalid/x'),new RegExp(`连不上代理 http://127.0.0.1:${port}`));
});
