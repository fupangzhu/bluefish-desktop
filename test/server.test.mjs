import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from '../server.mjs';
test('runtime server blocks every editor route even when its files remain beside it',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const base='http://127.0.0.1:'+server.address().port;for(const route of ['/','/index.html','/style.css','/src/app.mjs','/src/preview.mjs','/examples/promptsoul-segment.json'])assert.equal((await fetch(base+route)).status,404,route);for(const route of ['/overlay.html','/menu.html','/src/eyes.mjs','/src/fringe.mjs','/src/motion.mjs','/assets/rig.json'])assert.equal((await fetch(base+route)).status,200,route);}finally{await new Promise(r=>server.close(r));}
});
test('the source editor explicitly enables preview UI and modules',async()=>{
 const server=createServer({editor:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const base='http://127.0.0.1:'+server.address().port;for(const route of ['/','/style.css','/src/app.mjs','/src/preview.mjs'])assert.equal((await fetch(base+route)).status,200,route);}finally{await new Promise(r=>server.close(r));}
});
