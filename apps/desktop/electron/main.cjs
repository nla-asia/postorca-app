const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// Persist the session with the OS keychain. Without encryption, keep it in memory.
const sessionFile = () => path.join(app.getPath("userData"), "session.bin");
let session = null;
function readSession() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const saved = JSON.parse(
      safeStorage.decryptString(fs.readFileSync(sessionFile())),
    );
    return typeof saved?.token === "string" && typeof saved?.apiUrl === "string"
      ? saved
      : null;
  } catch {
    return null;
  }
}
function writeSession(value) {
  session = value;
  if (!safeStorage.isEncryptionAvailable()) return;
  fs.writeFileSync(
    sessionFile(),
    safeStorage.encryptString(JSON.stringify(value)),
    { mode: 0o600 },
  );
}
function clearSession() {
  session = null;
  fs.rmSync(sessionFile(), { force: true });
}
// Only an app window's top frame may access its session.
function trusted(event) {
  return (
    !!BrowserWindow.fromWebContents(event.sender) &&
    event.senderFrame === event.sender.mainFrame
  );
}
ipcMain.handle("session:get", (event) =>
  trusted(event) ? (session?.token ?? null) : null,
);
ipcMain.handle("session:set", (event, value) => {
  if (
    trusted(event) &&
    typeof value?.token === "string" &&
    value.token.length < 4096 &&
    typeof value.apiUrl === "string" &&
    /^https?:\/\/[^\s]+$/.test(value.apiUrl)
  ) {
    writeSession({ token: value.token, apiUrl: value.apiUrl });
  }
});
ipcMain.handle("session:clear", (event) => {
  if (trusted(event)) clearSession();
});

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
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
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

// One process owns the saved session for this desktop profile.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return createWindow();
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.whenReady().then(() => {
  session = readSession();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
