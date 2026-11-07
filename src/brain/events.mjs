// Append-only event stream (after dsh-fish): the single source of truth for what was said and done.
// Each event: {v, seq, id, ts, type, channel, text?, action?}. Never rewritten; corrections are new events.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class EventStore{
  constructor(file=null,{now=()=>Date.now(),keep=2000}={}){
    this.file=file;this.now=now;this.keep=keep;this.events=[];this.seq=0;
    if(file){
      try{
        for(const line of fs.readFileSync(file,'utf8').split('\n')){
          if(!line.trim())continue;
          try{const e=JSON.parse(line);if(e&&Number.isFinite(e.seq)){this.events.push(e);this.seq=Math.max(this.seq,e.seq);}}catch{}
        }
      }catch{}
      if(this.events.length>this.keep)this.events=this.events.slice(-this.keep);
    }
  }
  append(event){
    const e={v:1,seq:++this.seq,id:crypto.randomUUID(),ts:this.now(),...event};
    this.events.push(e);if(this.events.length>this.keep)this.events.shift();
    if(this.file){try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.appendFileSync(this.file,JSON.stringify(e)+'\n');}catch{}}
    return e;
  }
  recent(n){return n>0?this.events.slice(-n):[];}
}
