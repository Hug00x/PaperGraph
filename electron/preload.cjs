const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld('papergraphLocalChat', {
  run: request => ipcRenderer.invoke('local-chat:run', request),
  cancel: requestId => ipcRenderer.invoke('local-chat:cancel', requestId),
  subscribe: callback => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('local-chat:changed', listener);
    return () => ipcRenderer.removeListener('local-chat:changed', listener);
  },
});

contextBridge.exposeInMainWorld('papergraphResearch', {
  getAvailability: () => ipcRenderer.invoke('research:availability'),
  connect: () => ipcRenderer.invoke('research:connect'),
  run: request => ipcRenderer.invoke('research:run', request),
  cancel: requestId => ipcRenderer.invoke('research:cancel', requestId),
});

contextBridge.exposeInMainWorld("papergraphAnara", {
  getState: () => ipcRenderer.invoke("anara:state"),
  connect: () => ipcRenderer.invoke("anara:connect"),
  disconnect: () => ipcRenderer.invoke("anara:disconnect"),
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("anara:changed", listener);
    return () => ipcRenderer.removeListener("anara:changed", listener);
  },
});

// Fixed messages only. No paths, executable names, URLs or arbitrary commands.
contextBridge.exposeInMainWorld("papergraphRuntime", {
  getState: () => ipcRenderer.invoke("semantic-runtime:state"),
  retry: () => ipcRenderer.invoke("semantic-runtime:retry"),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("semantic-runtime:changed", listener);
    return () => ipcRenderer.removeListener("semantic-runtime:changed", listener);
  },
});
