const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopInfo', {
  platform: process.platform,
  isDesktop: true,
  pickDirectories: (options = {}) =>
    ipcRenderer.invoke('desktop:pick-directories', {
      multiple: Boolean(options && typeof options === 'object' && options.multiple),
    }),
});
