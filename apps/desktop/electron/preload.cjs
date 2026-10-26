const { contextBridge, ipcRenderer } = require("electron");

// Expose capabilities, not unrestricted IPC or Node access.
contextBridge.exposeInMainWorld("postorca", {
  session: {
    get: () => ipcRenderer.invoke("session:get"),
    set: (session) => ipcRenderer.invoke("session:set", session),
    clear: () => ipcRenderer.invoke("session:clear"),
  },
});
