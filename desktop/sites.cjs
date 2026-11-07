// Scan-code login for the sites she may read later (B站, 小红书).
// The site's own login page opens in a normal window so the owner scans a code rendered at the
// site's native size, and the session then lives in a persistent partition — no password, no token
// handling, nothing to keep in sync by hand.
const {session,BrowserWindow}=require('electron');

const SITES={
  bilibili:{label:'B站',login:'https://passport.bilibili.com/login',home:'https://www.bilibili.com/',cookie:'SESSDATA'},
  xiaohongshu:{label:'小红书',login:'https://www.xiaohongshu.com/login',home:'https://www.xiaohongshu.com/',cookie:'web_session'}
};
const LOGIN_TIMEOUT_MS=5*60*1000;

function createSiteHost({out=()=>{},log=console.warn,sites=SITES,partition=key=>'persist:'+key}={}){
  const wins=new Map(),timers=new Map();
  const ses=key=>session.fromPartition(partition(key));
  const def=key=>sites[key]||null;

  async function status(key){
    const d=def(key);if(!d)return {state:'unknown'};
    try{
      const list=await ses(key).cookies.get({name:d.cookie});
      return {state:list.length?'connected':'off',label:d.label,home:d.home};
    }catch(e){log('site: cannot read cookies',key,e.message);return {state:'off',label:d.label,message:e.message};}
  }
  function stopWatch(key){const t=timers.get(key);if(t){clearInterval(t);timers.delete(key);}}
  function closeWindow(key){const w=wins.get(key);wins.delete(key);if(w&&!w.isDestroyed())w.close();}

  // Opens the site's login page and watches for the session cookie; resolves once the window is up.
  async function login(key){
    const d=def(key);if(!d)throw Error('没有这个网站');
    const current=await status(key);
    if(current.state==='connected')return current;
    if(wins.has(key)){wins.get(key).focus();return {state:'waiting',label:d.label};}
    const win=new BrowserWindow({width:480,height:720,title:d.label+' 登录',autoHideMenuBar:true,backgroundColor:'#ffffff',
      webPreferences:{partition:partition(key),nodeIntegration:false,contextIsolation:true,sandbox:true}});
    wins.set(key,win);
    win.on('closed',()=>{wins.delete(key);stopWatch(key);});
    win.webContents.on('did-fail-load',(_e,code,desc)=>log('site: login page failed',key,code,desc));
    win.loadURL(d.login).catch(e=>log('site: login page failed',key,e.message));
    out(key,{state:'waiting',label:d.label,home:d.home});
    stopWatch(key);
    const started=Date.now();
    timers.set(key,setInterval(async()=>{
      const st=await status(key);
      if(st.state==='connected'){stopWatch(key);out(key,st);closeWindow(key);return;}
      if(Date.now()-started>LOGIN_TIMEOUT_MS){stopWatch(key);out(key,{state:'timeout',label:d.label});}
    },1000));
    return {state:'waiting',label:d.label};
  }

  async function logout(key){
    stopWatch(key);closeWindow(key);
    try{await ses(key).clearStorageData();}catch(e){log('site: logout failed',key,e.message);}
    const st={state:'off',label:def(key)?.label};out(key,st);return st;
  }

  function dispose(){for(const key of [...wins.keys()])closeWindow(key);for(const key of [...timers.keys()])stopWatch(key);}

  return {status,login,logout,dispose,sites};
}

module.exports={createSiteHost,SITES};
