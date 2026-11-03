const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pet',{
  onPointer:callback=>ipcRenderer.on('pointer',(_e,p)=>callback(p)),
  onAction:callback=>ipcRenderer.on('action',(_e,name)=>callback(name)),
  onSettings:callback=>ipcRenderer.on('settings',(_e,value)=>callback(value)),
  getSettings:()=>ipcRenderer.invoke('settings:get'),
  updateSettings:value=>ipcRenderer.invoke('settings:set',value),
  resizeStep:step=>ipcRenderer.send('resize-step',step),
  setInteractive:hit=>ipcRenderer.send('interactive',hit===true),
  drag:on=>ipcRenderer.send('drag',on===true),
  menu:()=>ipcRenderer.send('menu')
});
