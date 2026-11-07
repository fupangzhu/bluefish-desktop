// Pure helpers for the desktop tools: parse agent-desktop's JSON envelope, and turn an
// accessibility tree into a short outline the model can actually read.
export const DESK={maxNodes:40,maxChars:1200,maxDepth:8};

// agent-desktop prints one JSON object per command; be tolerant of stray log lines.
export function parseEnvelope(stdout){
  const text=String(stdout??'').trim();
  if(!text)return null;
  const lines=text.split(/\r?\n/).filter(l=>l.trim().startsWith('{'));
  for(let i=lines.length-1;i>=0;i--){
    try{const v=JSON.parse(lines[i]);if(v&&typeof v==='object'&&'ok' in v)return v;}catch{}
  }
  return null;
}

export function flatten(node,out=[],depth=0,limit=DESK.maxNodes){
  if(!node||out.length>=limit)return out;
  const name=String(node.name??'').trim();
  if(name)out.push({role:String(node.role??''),name,depth});
  for(const kid of node.children??[]){
    if(out.length>=limit)break;
    flatten(kid,out,depth+1,limit);
  }
  return out;
}

// window title + a flat "role：name" list, capped so a huge page cannot flood the prompt.
export function outline(data,{max=DESK.maxNodes,maxChars=DESK.maxChars}={}){
  const roots=Array.isArray(data?.tree)?data.tree:[data?.tree].filter(Boolean);
  const nodes=roots.flatMap(r=>flatten(r,[],0,max)).slice(0,max);
  const title=String(data?.window?.title??'').trim();
  let text=nodes.map(n=>`${n.role}：${n.name}`).join('\n');
  if(text.length>maxChars)text=text.slice(0,maxChars)+'…';
  return {title,count:nodes.length,text};
}

const pad=n=>String(n).padStart(2,'0');
export function shotName(ms){
  const d=new Date(ms??Date.now());
  return `shot-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
}

export function shotText({path,app,width,height}){
  const size=width&&height?`，${width}×${height}`:'';
  const where=app?`（${app}）`:'（整个屏幕）';
  return `截图好了${where}${size}，存在 ${path}，也放进了剪贴板，可以直接粘贴。`;
}

export function lookText({title,count,text}){
  if(!count)return `没读出「${title||'当前窗口'}」里的控件——这个界面可能没有无障碍信息，我可以改成截图给你。`;
  return `「${title||'当前窗口'}」里能读到 ${count} 个元素：\n${text}`;
}
