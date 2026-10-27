const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  safeStorage,
  shell,
} = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DesktopConnection } = require("./connection.cjs");
const plugins = require("./plugins/index.cjs");
const workingFolder = require("./working-folder.cjs");

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
let refreshing = null;
/**
 * Renews the login with its refresh token, once for all concurrent callers (the
 * window and the desktop connection). Resolves to the new access token, or null
 * when the server ended the session; rejects when the server cannot be reached.
 */
function refreshSession() {
  refreshing ??= (async () => {
    const current = session;
    if (!current?.refreshToken) return null;
    const response = await fetch(`${current.apiUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
      signal: AbortSignal.timeout(15_000),
    });
    // Signed out or in again meanwhile: that login stands.
    if (current !== session) return session?.token ?? null;
    if (response.status === 401) {
      clearSession();
      return null;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { token, refreshToken } = await response.json();
    // Same login with new tokens: updated in place.
    Object.assign(current, { token, refreshToken });
    writeSession(current);
    return token;
  })().finally(() => (refreshing = null));
  return refreshing;
}
// Stable per-install device ID; the server binds it into this device's token.
function installId() {
  const file = path.join(app.getPath("userData"), "install-id");
  try {
    const id = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f-]{36}$/.test(id)) return id;
  } catch {}
  const id = crypto.randomUUID();
  fs.writeFileSync(file, id);
  return id;
}
// The server reaches this computer through it, for tools that run here.
let desktop;
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
    typeof value.refreshToken === "string" &&
    value.refreshToken.length < 256 &&
    typeof value.apiUrl === "string" &&
    /^https?:\/\/[^\s]+$/.test(value.apiUrl)
  ) {
    writeSession({
      token: value.token,
      refreshToken: value.refreshToken,
      apiUrl: value.apiUrl,
    });
    desktop?.setSession(session);
    askForWorkingFolder(BrowserWindow.fromWebContents(event.sender));
  }
});
ipcMain.handle("session:refresh", (event) =>
  trusted(event) ? refreshSession() : null,
);
ipcMain.handle("session:clear", (event) => {
  if (!trusted(event)) return;
  // Ends the session on the server too, so its refresh token stops working.
  if (session?.refreshToken)
    void fetch(`${session.apiUrl}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {});
  clearSession();
  desktop?.setSession(null);
});

// A project folder for the Brand Profile: only picked here; the renderer saves it.
ipcMain.handle("project-folder:choose", async (event) => {
  if (!trusted(event)) return null;
  const result = await dialog.showOpenDialog(
    BrowserWindow.fromWebContents(event.sender),
    {
      title: "Add a project folder",
      message:
        "Orca can read what changes in this folder, such as code, docs and designs, to find content ideas in your work.",
      buttonLabel: "Add project",
      properties: ["openDirectory"],
    },
  );
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("working-folder:get", (event) =>
  trusted(event) ? workingFolder.get() : null,
);
ipcMain.handle("working-folder:choose", (event) =>
  trusted(event)
    ? workingFolder.choose(BrowserWindow.fromWebContents(event.sender))
    : null,
);
// A signed-in founder without a working folder is asked for one, once per launch;
// they can choose or change it later in Settings.
let askedForFolder = false;
function askForWorkingFolder(win) {
  if (askedForFolder || !session || workingFolder.get() || !win) return;
  askedForFolder = true;
  void workingFolder.choose(win);
}

// Shown notifications are held until dismissed: one that is garbage-collected
// stops answering clicks.
const shownNotifications = new Set();
/** The app's window, created when there is none; `send` waits until it has loaded. */
function appWindow() {
  const window = BrowserWindow.getAllWindows()[0] ?? createWindow();
  return {
    window,
    send(channel, value) {
      const send = () => window.webContents.send(channel, value);
      if (window.webContents.isLoading())
        window.webContents.once("did-finish-load", send);
      else send();
    },
  };
}
/**
 * A notification from the server (work finished or needs input); clicking it opens
 * that task. When the OS won't show it (notifications are off for this app), the
 * app shows it instead.
 */
function notifyFounder(data) {
  if (typeof data?.title !== "string") return;
  const note = {
    title: data.title.slice(0, 120),
    body: typeof data.body === "string" ? data.body.slice(0, 240) : "",
    taskId:
      typeof data.taskId === "string" && /^[0-9a-f-]{36}$/.test(data.taskId)
        ? data.taskId
        : undefined,
  };
  const showInApp = () => {
    appWindow().send("notification:show", note);
    if (process.platform === "darwin") app.dock?.bounce("informational");
  };
  if (!Notification.isSupported()) return showInApp();
  const notification = new Notification({ title: note.title, body: note.body });
  notification.on("click", () => {
    shownNotifications.delete(notification);
    const { window, send } = appWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (note.taskId) send("task:open", note.taskId);
  });
  notification.on("failed", () => {
    shownNotifications.delete(notification);
    showInApp();
  });
  notification.on("close", () => shownNotifications.delete(notification));
  shownNotifications.add(notification);
  notification.show();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
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
  window.webContents.once("did-finish-load", () => askForWorkingFolder(window));

  const loading =
    !app.isPackaged && process.argv.includes("--dev")
      ? window.loadURL("http://127.0.0.1:5173")
      : window.loadFile(path.join(__dirname, "../dist/index.html"));

  loading.catch((error) => {
    console.error("Unable to load the desktop interface:", error);
    app.quit();
  });
  return window;
}

// One process owns the saved session for this desktop profile.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return createWindow();
  if (window.isMinimized()) window.restore();
  window.focus();
});

// Windows shows notifications only for an app with this ID.
if (process.platform === "win32") app.setAppUserModelId("com.postorca.desktop");
app.whenReady().then(() => {
  desktop = new DesktopConnection(installId(), refreshSession, notifyFounder);
  session = readSession();
  desktop.setSession(session);
  plugins.start();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quitting takes this computer offline right away; the saved session stays.
app.on("before-quit", () => {
  desktop?.setSession(null);
  plugins.shutdown();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
