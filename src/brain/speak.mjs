// Turns one reply into a few chat lines and paces them like typing (after MaiBot's splitter).
export const SPEAK={maxLines:3,minLine:4,perChar:.25,perLatin:.12,minDelay:.6,maxDelay:4,enter:.3};

const END=/([。！？!?…~～]+|\n+)/;
// Strip what a chat line should never carry: markdown, stage directions, wrapping quotes.
export function cleanReply(text){
  return String(text??'')
    .replace(/```[\s\S]*?```/g,'')
    .replace(/[*_#>`]+/g,'')
    .replace(/[（(][^（）()]{0,24}[）)]/g,'')
    .replace(/^\s*["“「『]+|["”」』]+\s*$/g,'')
    .replace(/[ \t]+/g,' ')
    .trim();
}

export function splitReply(text,{maxLines=SPEAK.maxLines,minLine=SPEAK.minLine}={}){
  const clean=cleanReply(text);if(!clean)return [];
  const parts=[];let buf='';
  for(const piece of clean.split(END)){
    if(!piece)continue;
    if(/^\n+$/.test(piece)){if(buf.trim())parts.push(buf.trim());buf='';continue;}
    buf+=piece;
    if(END.test(piece)){parts.push(buf.trim());buf='';}
  }
  if(buf.trim())parts.push(buf.trim());
  // Fold lines that are too short into the previous one.
  const merged=[];
  for(const p of parts){if(merged.length&&[...p].length<minLine)merged[merged.length-1]+=p;else merged.push(p);}
  // Keep at most maxLines: join the tail together.
  while(merged.length>maxLines){const tail=merged.pop();merged[merged.length-1]+=tail;}
  return merged.filter(Boolean);
}

// Seconds of "typing" before a line appears.
export function typingDelay(line,{perChar=SPEAK.perChar,perLatin=SPEAK.perLatin,minDelay=SPEAK.minDelay,maxDelay=SPEAK.maxDelay,enter=SPEAK.enter}={}){
  let cjk=0,latin=0;
  for(const ch of String(line))if(/[㐀-鿿]/.test(ch))cjk++;else if(/\S/.test(ch))latin++;
  return Math.min(maxDelay,Math.max(minDelay,cjk*perChar+latin*perLatin+enter));
}
