// Shared by the custom menu window and the console window.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petControl',{
  getState:()=>ipcRenderer.invoke('ctl:get-state'),
  onState:callback=>{ipcRenderer.on('state',(_e,state)=>callback(state));},
  set:patch=>ipcRenderer.send('ctl:set',patch),
  action:name=>ipcRenderer.send('ctl:action',String(name)),
  command:name=>ipcRenderer.send('ctl:command',String(name)),
  fit:height=>ipcRenderer.send('ctl:fit',Number(height))
});
