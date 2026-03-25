const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopInfo', {
  isDesktop: true,
  pickDirectories: (options = {}) =>
    ipcRenderer.invoke('desktop:pick-directories', {
      multiple: Boolean(options && typeof options === 'object' && options.multiple),
    }),
  getOllamaStatus: () => ipcRenderer.invoke('desktop:get-ollama-status'),
  installOllama: (options = {}) =>
    ipcRenderer.invoke('desktop:install-ollama', {
      background: !options || typeof options !== 'object' || options.background !== false,
    }),
  openExternal: (targetUrl) => ipcRenderer.invoke('desktop:open-external', targetUrl),
});
