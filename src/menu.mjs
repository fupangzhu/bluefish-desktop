import {hydrate} from './icons.mjs';
hydrate();
const ctl=window.petControl;
const $=s=>document.querySelector(s);
const card=$('.card'),size=$('#size'),sizeValue=$('#sizeValue');
const toggles={follow:$('#follow'),idle:$('#idle'),docked:$('#docked')};
// Without the Electron bridge (plain browser) the menu still renders, against a local stub.
const local={size:240,docked:true,follow:true,idle:true,reduced:false,pose:{yaw:0,pitch:0,roll:0}};
const api=ctl||{getState:async()=>local,onState(){},set(p){Object.assign(local,p);render(local);},command(){},fit(){}};
let dragging=false;
function progress(el){el.style.setProperty('--progress',((el.value-el.min)/(el.max-el.min)*100)+'%');}
function render(s){
  if(!s)return;
  if(!dragging&&Number.isFinite(s.size)){size.value=s.size;progress(size);sizeValue.textContent=Math.round(s.size);}
  for(const [k,el] of Object.entries(toggles))if(k in s)el.setAttribute('aria-pressed',String(!!s[k]));
  fit();
}
let pendingSize=null,raf=0;
function sendSize(){raf=0;if(pendingSize==null)return;const v=pendingSize;pendingSize=null;api.set({size:v});}
size.addEventListener('input',()=>{progress(size);sizeValue.textContent=size.value;pendingSize=+size.value;if(!raf)raf=requestAnimationFrame(sendSize);});
size.addEventListener('pointerdown',()=>{dragging=true;});
for(const ev of ['pointerup','pointercancel','blur'])size.addEventListener(ev,()=>{dragging=false;});
document.querySelectorAll('[data-command]').forEach(b=>b.addEventListener('click',()=>api.command(b.dataset.command)));
for(const [k,el] of Object.entries(toggles))el.addEventListener('click',()=>{const next=el.getAttribute('aria-pressed')!=='true';el.setAttribute('aria-pressed',String(next));api.set({[k]:next});});
addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();api.command('close-menu');}});
// The window is reused, so replay the entrance each time it regains focus.
function replay(){lastFit=0;fit();card.classList.add('replay');void card.offsetWidth;card.classList.remove('replay');}
addEventListener('focus',replay);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)replay();});
let lastFit=0;
function fit(){const h=Math.ceil(card.getBoundingClientRect().height+20);if(h!==lastFit){lastFit=h;api.fit(h);}}
new ResizeObserver(fit).observe(card);
addEventListener('resize',fit);
api.onState(render);
render(await api.getState());
fit();
