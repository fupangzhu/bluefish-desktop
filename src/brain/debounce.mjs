// Wait until the owner has finished a burst of messages (after MaiBot's "natural" debounce).
// Pure: callers pass time in seconds and ask for the deadline.
export const DEBOUNCE={quiet:2,active:5,batchLimit:8,activeGap:30,typingGrace:3};

export class Debounce{
  constructor(opts={}){this.opts={...DEBOUNCE,...opts};this.reset();this.lastArrival=null;}
  reset(){this.first=null;this.deadline=null;this.typingUntil=0;}
  get pending(){return this.first!==null;}
  // A message arrived at time `now`.
  push(now){
    const o=this.opts,active=this.lastArrival!==null&&now-this.lastArrival<=o.activeGap;
    if(this.first===null)this.first=now;
    this.lastArrival=now;
    const wait=this.deadline===null?(active?o.active:o.quiet):o.quiet;
    this.deadline=Math.min(this.first+o.batchLimit,now+wait);
    return this.deadline;
  }
  // The owner is still typing: hold the batch a little longer (never past the batch limit).
  typing(now){
    if(this.first===null)return null;
    this.typingUntil=now+this.opts.typingGrace;
    this.deadline=Math.min(this.first+this.opts.batchLimit,Math.max(this.deadline,this.typingUntil));
    return this.deadline;
  }
  // True once the batch should be handed to the planner; consumes it.
  due(now){
    if(this.first===null||now<this.deadline)return false;
    this.reset();return true;
  }
}
