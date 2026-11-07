// The chat brain: debounce -> planner (tools) -> replyer -> paced lines.
// Everything with side effects is injected, so tests can drive it with a fake model.
import {Debounce} from './debounce.mjs';
import {splitReply,typingDelay} from './speak.mjs';
import {ACTIONS,plannerTools,plannerSystem,replyerSystem,situation,replyerUser} from './prompts.mjs';

export const BRAIN={maxRounds:4,historyEvents:24,waitMin:5,waitMax:120};

const realClock={now:()=>Date.now(),setTimeout:(f,ms)=>setTimeout(f,ms),clearTimeout:id=>clearTimeout(id),
  sleep:(ms,signal)=>new Promise(resolve=>{const id=setTimeout(()=>resolve(true),ms);signal?.addEventListener('abort',()=>{clearTimeout(id);resolve(false);},{once:true});})};

export class Brain{
  // llm({role,messages,tools,signal,temperature,maxTokens}) -> {content,toolCalls,message}
  // store: {append(event)->event with seq, recent(n)->events}
  // out: {say(text,channel), act(action,channel), typing(on,channel), notice(text,channel), state(name)}
  constructor({llm,store,out,persona=()=>'',clock=realClock,budget=null,debounce={},log=()=>{}}){
    Object.assign(this,{llm,store,out,persona,clock,budget,log});
    this.debounce=new Debounce(debounce);this.timer=null;this.running=false;
    this.interrupt=false;this.plannerAbort=null;this.waitAbort=null;this.handledSeq=this.lastSeq();this.idle=null;
  }
  lastSeq(){const r=this.store.recent(1);return r.length?r[r.length-1].seq:0;}
  // A line from the owner arrived on some channel.
  receive(text,channel='desktop'){
    text=String(text??'').trim();if(!text)return null;
    const e=this.store.append({type:'heard',text:text.slice(0,2000),channel});
    this.channel=channel;
    if(this.running){this.interrupt=true;this.plannerAbort?.abort();this.waitAbort?.abort();}
    this.schedule(this.debounce.push(this.clock.now()/1000));
    return e;
  }
  typing(){const d=this.debounce.typing(this.clock.now()/1000);if(d!==null)this.schedule(d);}
  schedule(deadline){
    if(this.timer)this.clock.clearTimeout(this.timer);
    const ms=Math.max(0,deadline*1000-this.clock.now());
    this.timer=this.clock.setTimeout(()=>{this.timer=null;if(this.debounce.due(this.clock.now()/1000))this.kick();else if(this.debounce.pending)this.schedule(this.debounce.deadline);},ms);
  }
  kick(){if(!this.running)this.idle=this.turn().finally(()=>{this.idle=null;});}
  // Resolves when the brain has nothing left to do (for tests and shutdown).
  async settle(){for(let i=0;i<200;i++){if(this.idle)await this.idle;else if(this.timer||this.debounce.pending)await this.clock.sleep(20);else return;}}
  stop(){if(this.timer)this.clock.clearTimeout(this.timer);this.timer=null;this.debounce.reset();this.plannerAbort?.abort();this.waitAbort?.abort();this.stopped=true;}

  context(startSeq){
    const events=this.store.recent(BRAIN.historyEvents+40).filter(e=>['heard','said','acted'].includes(e.type));
    return {history:events.filter(e=>e.seq<=startSeq).slice(-BRAIN.historyEvents),fresh:events.filter(e=>e.seq>startSeq)};
  }
  plannerMessages(startSeq){
    const {history,fresh}=this.context(startSeq);
    return [{role:'system',content:plannerSystem(this.persona())},{role:'user',content:situation({now:this.clock.now(),channel:this.channel,history,fresh})}];
  }

  async turn(){
    if(this.running||this.stopped)return;
    // Everything the owner said was already handled inside an earlier (interrupted) turn.
    if(this.lastHeardSeq()<=this.handledSeq)return;
    this.running=true;
    const startSeq=this.handledSeq;this.handledSeq=this.lastSeq();
    const channel=this.channel||'desktop';
    const result={rounds:0,spoke:false,acted:[],ended:'done'};
    try{
      if(this.budget?.exhausted()){this.out.act('shakehead',channel);this.out.notice('今天聊得太多了，模型额度用完了，明天再聊吧。',channel);result.ended='budget';return result;}
      this.out.state?.('thinking',channel);
      let messages=this.plannerMessages(startSeq);
      while(result.rounds<BRAIN.maxRounds&&!this.stopped){
        result.rounds++;this.interrupt=false;
        const ac=new AbortController();this.plannerAbort=ac;
        let res;
        try{res=await this.llm({role:'main',messages,tools:plannerTools(),signal:ac.signal,temperature:.7,maxTokens:600});}
        catch(e){if(e?.kind==='aborted'&&this.interrupt){this.handledSeq=this.lastSeq();messages=this.plannerMessages(startSeq);result.rounds--;continue;}throw e;}
        finally{this.plannerAbort=null;}
        // New words arrived while she was thinking: think again with them.
        if(this.interrupt){this.handledSeq=this.lastSeq();messages=this.plannerMessages(startSeq);continue;}
        if(!res.toolCalls.length){result.ended='no-tool';break;}
        messages.push({role:'assistant',content:res.content||'',tool_calls:res.toolCalls.map(c=>c.raw||{id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}})});
        let end=false,waited=false,spokeNow=false;
        for(const call of res.toolCalls){
          let out;
          if(call.name==='stop'){out='好';end=true;}
          else if(call.name==='act')out=this.doAct(call.args,channel,result);
          else if(call.name==='reply'){out=await this.doReply(call.args,channel,result);spokeNow=result.spoke;}
          else if(call.name==='wait'){out=await this.doWait(call.args);waited=true;}
          else out='没有这个工具';
          messages.push({role:'tool',tool_call_id:call.id,content:out});
        }
        if(end){result.ended='stop';break;}
        // Once she has spoken (and is not waiting), the turn is over; another round would only cost tokens.
        if(spokeNow&&!waited&&!this.interrupt){result.ended='spoke';break;}
        if(this.interrupt){this.handledSeq=this.lastSeq();messages=this.plannerMessages(startSeq);}
      }
      if(result.rounds>=BRAIN.maxRounds&&result.ended==='done')result.ended='max-rounds';
    }catch(e){
      result.ended='error';result.error=e?.message||String(e);
      this.log('brain turn failed',result.error);
      this.out.act('shakehead',channel);
      this.out.notice(e?.kind==='config'?result.error+'，请在设置里填好。':'出错了：'+result.error,channel,{settings:e?.kind==='config'||e?.kind==='auth'});
    }finally{
      this.out.typing(false,channel);this.out.state?.('idle',channel);
      this.running=false;
      // Messages that came in during the very end of the turn get their own turn.
      if(!this.stopped&&this.lastHeardSeq()>this.handledSeq&&!this.timer)this.schedule(this.clock.now()/1000);
    }
    return result;
  }
  lastHeardSeq(){const h=this.store.recent(40).filter(e=>e.type==='heard');return h.length?h[h.length-1].seq:0;}

  doAct(args,channel,result){
    const action=String(args?.action||'');
    if(!(action in ACTIONS))return '做不了这个动作，可选：'+Object.keys(ACTIONS).join('/');
    this.out.act(action,channel);this.store.append({type:'acted',action,channel});result.acted.push(action);
    return '做了：'+ACTIONS[action];
  }
  async doReply(args,channel,result){
    if(result.spoke)return '这一轮已经说过话了';
    const reference=String(args?.reference||'').slice(0,400),tone=String(args?.tone||'').slice(0,40);
    const history=this.store.recent(BRAIN.historyEvents+10).filter(e=>['heard','said','acted'].includes(e.type)).slice(-BRAIN.historyEvents);
    this.out.typing(true,channel);
    const res=await this.llm({role:'main',messages:[{role:'system',content:replyerSystem(this.persona())},{role:'user',content:replyerUser({now:this.clock.now(),history,reference,tone})}],temperature:.9,maxTokens:300});
    const lines=splitReply(res.content);
    if(!lines.length){this.out.typing(false,channel);return '没想好说什么，什么都没说';}
    for(const [i,line] of lines.entries()){
      if(i>0)this.out.typing(true,channel);
      await this.clock.sleep(typingDelay(line)*1000);
      this.out.typing(false,channel);
      this.out.say(line,channel);this.store.append({type:'said',text:line,channel});
    }
    result.spoke=true;
    return '说了：'+lines.join(' ');
  }
  async doWait(args){
    const s=Math.min(BRAIN.waitMax,Math.max(BRAIN.waitMin,Number(args?.seconds)||10));
    const ac=new AbortController();this.waitAbort=ac;
    if(this.interrupt)ac.abort();
    const full=await this.clock.sleep(s*1000,ac.signal);this.waitAbort=null;
    return full?`等了 ${s} 秒，主人没有说话`:'等的时候主人说话了';
  }
}
