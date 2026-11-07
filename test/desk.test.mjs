import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEnvelope,flatten,outline,shotName,shotText,lookText,DESK} from '../src/agent/desk.mjs';

const envelope={ok:true,command:'snapshot',data:{window:{title:'记事本 - 无标题'},tree:[{role:'window',name:'记事本 - 无标题',children:[
  {role:'button',name:'保存',children:[]},
  {role:'edit',name:'文本编辑器',children:[{role:'text',name:'第一行',children:[]}]}
]}]}};

test('envelope parsing survives log noise and a missing payload',()=>{
  assert.equal(parseEnvelope(JSON.stringify(envelope)).ok,true);
  assert.equal(parseEnvelope(`debug: something\n${JSON.stringify(envelope)}\n`).ok,true);
  assert.equal(parseEnvelope('not json'),null);
  assert.equal(parseEnvelope(''),null);
  assert.equal(parseEnvelope('{"foo":1}'),null,'an object without ok is not an envelope');
});

test('the tree flattens depth-first into named elements and skips nameless containers',()=>{
  const nodes=flatten(envelope.data.tree[0]);
  assert.deepEqual(nodes.map(n=>`${n.role}/${n.name}`),['window/记事本 - 无标题','button/保存','edit/文本编辑器','text/第一行']);
  assert.ok(nodes.every(n=>n.name),'nameless containers are dropped');
});

test('the outline keeps the title, counts elements, and is capped',()=>{
  const o=outline(envelope.data);
  assert.equal(o.title,'记事本 - 无标题');
  assert.equal(o.count,4);
  assert.match(o.text,/button：保存/);
  const capped=outline(envelope.data,{max:2,maxChars:10});
  assert.equal(capped.count,2);
  assert.ok(capped.text.length<=11,'truncated with an ellipsis');
});

test('a window without accessible children says so instead of pretending',()=>{
  const o=outline({window:{title:'画布'},tree:[{role:'window',name:'',children:[]}]});
  assert.equal(o.count,0);
  assert.match(lookText(o),/没读出「画布」/);
  assert.match(lookText(outline(envelope.data)),/能读到 4 个元素/);
});

test('screenshot names are sortable and stable',()=>{
  assert.equal(shotName(Date.UTC(2026,10,7,10,20,30)).length>0,true);
  assert.match(shotName(0),/^shot-\d{8}-\d{6}\.png$/);
  assert.notEqual(shotName(0),shotName(61000));
});

test('the screenshot line names the file, the size and the clipboard',()=>{
  const t=shotText({path:'C:/x/shot-1.png',width:3840,height:2160});
  assert.match(t,/整个屏幕/);
  assert.match(t,/3840×2160/);
  assert.match(t,/剪贴板/);
  assert.match(shotText({path:'C:/x/shot-1.png',app:'chrome.exe'}),/（chrome.exe）/);
});

test('the node cap is a real bound',()=>{
  assert.ok(DESK.maxNodes>0&&DESK.maxChars>0);
});
