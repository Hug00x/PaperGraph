const { contextBridge, ipcRenderer } = require("electron");

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
