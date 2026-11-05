const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petControl',{
 getState:()=>ipcRenderer.invoke('ctl:get-state'),onState:callback=>ipcRenderer.on('state',(_e,state)=>callback(state)),
 set:patch=>ipcRenderer.send('ctl:set',patch),command:name=>ipcRenderer.send('ctl:command',String(name)),fit:height=>ipcRenderer.send('ctl:fit',Number(height))
});
