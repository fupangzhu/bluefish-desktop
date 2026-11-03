const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pet',{
  onPointer:callback=>{ipcRenderer.on('pointer',(_e,p)=>callback(p));},
  onAction:callback=>{ipcRenderer.on('action',(_e,name)=>callback(name));},
  onState:callback=>{ipcRenderer.on('state',(_e,state)=>callback(state));},
  setInteractive:hit=>ipcRenderer.send('interactive',hit===true),
  drag:on=>ipcRenderer.send('drag',on===true),
  menu:()=>ipcRenderer.send('menu'),
  zoom:steps=>ipcRenderer.send('zoom',Number(steps))
});
