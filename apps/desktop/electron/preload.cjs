const { contextBridge, ipcRenderer } = require("electron");

// Expose capabilities, not unrestricted IPC or Node access.
contextBridge.exposeInMainWorld("postorca", {
  session: {
    get: () => ipcRenderer.invoke("session:get"),
    set: (session) => ipcRenderer.invoke("session:set", session),
    refresh: () => ipcRenderer.invoke("session:refresh"),
    clear: () => ipcRenderer.invoke("session:clear"),
  },
  projectFolder: {
    choose: () => ipcRenderer.invoke("project-folder:choose"),
  },
  /** Calls back with a notification the OS wouldn't show; returns unsubscribe. */
  onNotification: (callback) => {
    const listener = (_event, notification) => callback(notification);
    ipcRenderer.on("notification:show", listener);
    return () => ipcRenderer.removeListener("notification:show", listener);
  },
  /** Calls back with a task id when the founder clicks a notification for it. */
  onOpenTask: (callback) => {
    const listener = (_event, taskId) => callback(taskId);
    ipcRenderer.on("task:open", listener);
    return () => ipcRenderer.removeListener("task:open", listener);
  },
});
