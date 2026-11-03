import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
export function createServer(){return http.createServer(async(req,res)=>{
  try{if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
    const url=new URL(req.url,'http://127.0.0.1'),name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    if(!/^\/(index\.html|style\.css|src\/[a-z-]+\.mjs|assets\/(hand\.svg|rig\.json|master\.png|reconstructed\.png|layers\/[a-z_]+\.png)|examples\/[a-z-]+\.json)$/.test(name)){res.writeHead(404);return res.end();}
    const body=await readFile(path.join(root,name));res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('Not found');}
});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.BLUEFISH_PORT||8766),server=createServer();server.on('error',e=>{console.error(e.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>{const url='http://127.0.0.1:'+port;console.log('Bluefish preview: '+url);if(process.argv.includes('--open')&&process.platform==='win32'){const child=spawn('explorer.exe',[url],{detached:true,stdio:'ignore',windowsHide:true});child.on('error',e=>console.error('请手动打开 '+url+': '+e.message));child.unref();}});
}
