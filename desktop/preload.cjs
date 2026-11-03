const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pet',{
  onPointer:callback=>ipcRenderer.on('pointer',(_e,p)=>callback(p)),
  onAction:callback=>ipcRenderer.on('action',(_e,name)=>callback(name)),
  setInteractive:hit=>ipcRenderer.send('interactive',hit===true),
  drag:on=>ipcRenderer.send('drag',on===true),
  menu:()=>ipcRenderer.send('menu')
});
