const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const login = { token: 'access-one', refreshToken: 'refresh-one', apiUrl: 'https://api.example.test/api' };

async function launch({ saved, legacy, contents, fetch: fetchImpl } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'postorca-session-'));
  const file = path.join(profile, 'session.json');
  const oldFile = path.join(profile, 'session.bin');
  if (saved) fs.writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
  if (contents !== undefined) fs.writeFileSync(file, contents);
  if (legacy) fs.writeFileSync(oldFile, legacy);
  const handlers = new Map(), windows = [], connected = [], requests = [];
  let keychainAccesses = 0;
  class BrowserWindow {
    static getAllWindows() { return windows; }
    static fromWebContents(sender) { return windows.find(win => win.webContents === sender); }
    constructor() {
      this.webContents = { mainFrame: {}, setWindowOpenHandler() {}, on() {} };
      this.maximized = false;
      windows.push(this);
    }
    loadFile() { return Promise.resolve(); }
    loadURL() { return Promise.resolve(); }
    maximize() { this.maximized = true; }
  }
  const electron = {
    app: { isPackaged: true, getPath: () => profile, requestSingleInstanceLock: () => true, on() {}, whenReady: () => Promise.resolve(), setAboutPanelOptions() {} },
    BrowserWindow, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    Menu: { buildFromTemplate: () => [], setApplicationMenu() {} }, Notification: { isSupported: () => false },
    shell: {}, dialog: {},
  };
  // Accessing even the module must fail: launch and all session actions must stay local.
  Object.defineProperty(electron, 'safeStorage', { get() { keychainAccesses++; throw new Error('Unexpected Keychain access'); } });
  const modules = {
    electron,
    './connection.cjs': { DesktopConnection: class { setSession(value) { connected.push(value); } } },
    './plugins/index.cjs': { start() {}, shutdown() {} },
    './working-folder.cjs': { get: () => null },
  };
  const main = require.resolve('./main.cjs');
  vm.runInNewContext(fs.readFileSync(main, 'utf8'), {
    require: name => Object.hasOwn(modules, name) ? modules[name] : require(name),
    __dirname: path.dirname(main), process: { platform: 'darwin', argv: [] }, console,
    AbortSignal,
    fetch: async (url, init) => { requests.push({ url, init }); return fetchImpl ? fetchImpl(url, init) : Response.json({}); },
  }, { filename: main });
  await new Promise(resolve => setImmediate(resolve));
  const sender = windows[0].webContents;
  const event = { sender, senderFrame: sender.mainFrame };
  return {
    file, oldFile, windows, connected, requests,
    invoke: (name, ...args) => handlers.get(name)(event, ...args),
    untrusted: (name, ...args) => handlers.get(name)({ sender, senderFrame: {} }, ...args),
    close() { assert.equal(keychainAccesses, 0); fs.rmSync(profile, { recursive: true, force: true }); },
  };
}

test('first launch opens the window without touching Keychain or creating a session', async () => {
  const app = await launch();
  try {
    assert.equal(app.windows.length, 1);
    assert.equal(app.invoke('session:get'), null);
    assert.equal(fs.existsSync(app.file), false);
    assert.equal(app.connected.at(-1), null);
  } finally { app.close(); }
});

test('saved local login restores automatically without Keychain', async () => {
  const app = await launch({ saved: login });
  try {
    assert.equal(app.invoke('session:get'), login.token);
    assert.deepEqual(JSON.parse(JSON.stringify(app.connected.at(-1))), login);
    assert.equal(app.windows[0].maximized, true);
  } finally { app.close(); }
});

test('legacy encrypted login is left alone until a new sign-in saves a private local session', async () => {
  const app = await launch({ legacy: 'encrypted-session-fixture' });
  try {
    assert.equal(app.invoke('session:get'), null);
    assert.equal(fs.readFileSync(app.oldFile, 'utf8'), 'encrypted-session-fixture');
    app.invoke('session:set', login);
    assert.deepEqual(JSON.parse(fs.readFileSync(app.file)), login);
    assert.equal(fs.statSync(app.file).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(app.oldFile), false);
    assert.equal(app.invoke('session:get'), login.token);
    fs.chmodSync(app.file, 0o644);
    app.invoke('session:set', login);
    assert.equal(fs.statSync(app.file).mode & 0o777, 0o600);
  } finally { app.close(); }
});

test('untrusted frames cannot read, replace or clear a local login', async () => {
  const app = await launch({ saved: login });
  try {
    assert.equal(app.untrusted('session:get'), null);
    assert.equal(app.untrusted('session:refresh'), null);
    app.untrusted('session:set', { ...login, token: 'other' });
    app.untrusted('session:clear');
    assert.deepEqual(JSON.parse(fs.readFileSync(app.file)), login);
    assert.equal(app.requests.length, 0);
  } finally { app.close(); }
});

test('concurrent refreshes share one request and persist the rotated tokens locally', async () => {
  const updated = { token: 'access-two', refreshToken: 'refresh-two' };
  const app = await launch({ saved: login, fetch: async () => Response.json(updated) });
  try {
    assert.deepEqual(await Promise.all([app.invoke('session:refresh'), app.invoke('session:refresh')]), ['access-two', 'access-two']);
    assert.equal(app.requests.length, 1);
    assert.deepEqual(JSON.parse(app.requests[0].init.body), { refreshToken: login.refreshToken });
    assert.deepEqual(JSON.parse(fs.readFileSync(app.file)), { ...login, ...updated });
    assert.equal(fs.statSync(app.file).mode & 0o777, 0o600);
  } finally { app.close(); }
});

test('logout revokes the login and removes both local and legacy session files', async () => {
  const app = await launch({ saved: login, legacy: 'encrypted-session-fixture' });
  try {
    app.invoke('session:clear');
    assert.equal(app.invoke('session:get'), null);
    assert.equal(fs.existsSync(app.file), false);
    assert.equal(fs.existsSync(app.oldFile), false);
    assert.equal(app.connected.at(-1), null);
    assert.equal(app.requests[0].url, `${login.apiUrl}/auth/logout`);
    assert.deepEqual(JSON.parse(app.requests[0].init.body), { refreshToken: login.refreshToken });
  } finally { app.close(); }
});

test('a rejected refresh clears the saved login and malformed local files open at login', async () => {
  const rejected = await launch({ saved: login, fetch: async () => Response.json({}, { status: 401 }) });
  try {
    assert.equal(await rejected.invoke('session:refresh'), null);
    assert.equal(fs.existsSync(rejected.file), false);
  } finally { rejected.close(); }
  for (const contents of ['not JSON', JSON.stringify({ token: 3, apiUrl: login.apiUrl })]) {
    const app = await launch({ contents });
    try { assert.equal(app.invoke('session:get'), null); }
    finally { app.close(); }
  }
});
