const { app, BrowserWindow } = require("electron");
const path = require("node:path");

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    title: "PostOrca",
    backgroundColor: "#f8f9f7",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const loading =
    !app.isPackaged && process.argv.includes("--dev")
      ? window.loadURL("http://127.0.0.1:5173")
      : window.loadFile(path.join(__dirname, "../dist/index.html"));

  loading.catch((error) => {
    console.error("Unable to load the desktop interface:", error);
    app.quit();
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
