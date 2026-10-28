#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Downloaded packages include runtime/; repository use shares the desktop's pure
// Node relay implementation. Neither path starts Electron or a PostOrca server.
const runtime = fs.existsSync(path.join(__dirname, "runtime"))
  ? path.join(__dirname, "runtime")
  : path.resolve(__dirname, "../../apps/desktop/electron/plugins/browser");
const { BrowserRelay } = require(path.join(runtime, "relay.cjs"));
const { installWindowsHost } = require(path.join(runtime, "windows-pairing.cjs"));
const HOST = "com.postorca.browser.example";
const DEFAULT_ID = "bdfijompoabfinpmaepcpcfhdneghegf";
const defaultDirectory = () => path.join(os.homedir(), ".postorca-browser-companion");

function hostLocation(platform = process.platform, home = os.homedir()) {
  if (platform === "darwin") return path.join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${HOST}.json`);
  if (platform === "linux") return path.join(home, ".config/google-chrome/NativeMessagingHosts", `${HOST}.json`);
  if (platform === "win32") return null;
  throw new Error(`Unsupported platform: ${platform}`);
}

function extensionId(value = DEFAULT_ID) {
  if (!/^[a-p]{32}$/.test(value)) throw new Error("Extension ID must contain 32 letters from a through p.");
  return value;
}

function quoteShell(value) {
  if (/[\r\n]/.test(value)) throw new Error("Invalid native-host path.");
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function install({ directory = defaultDirectory(), id = DEFAULT_ID, platform = process.platform, home = os.homedir(), register } = {}) {
  id = extensionId(id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  directory = fs.realpathSync.native(directory);
  const pairingFile = path.join(directory, "pairing.json");
  if (platform === "win32") {
    return installWindowsHost({ userData: directory, executable: process.execPath,
      hostScript: path.join(runtime, "native-host.cjs"), pairingFile,
      extensionId: id, hostName: HOST, ...(register ? { register } : {}) });
  }
  const manifestFile = hostLocation(platform, home);
  if (fs.existsSync(manifestFile)) {
    const old = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (old.path !== path.join(directory, "native-host.sh")) {
      throw new Error(`A different example companion is registered at ${manifestFile}. Uninstall it first.`);
    }
  }
  const launcher = path.join(directory, "native-host.sh");
  fs.writeFileSync(launcher, ["#!/bin/sh",
    `export POSTORCA_PAIRING_FILE=${quoteShell(pairingFile)} POSTORCA_EXTENSION_ID=${id}`,
    `exec ${quoteShell(process.execPath)} ${quoteShell(path.join(runtime, "native-host.cjs"))} "$@"`, "",
  ].join("\n"), { mode: 0o700 });
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, JSON.stringify({ name: HOST, description: "PostOrca example companion",
    path: launcher, type: "stdio", allowed_origins: [`chrome-extension://${id}/`],
  }, null, 2));
  return { launcher, manifestFile };
}

function uninstall({ directory = defaultDirectory(), platform = process.platform, home = os.homedir(), register = execFileSync } = {}) {
  directory = fs.realpathSync.native(directory);
  if (platform === "win32") {
    const expected = path.join(directory, `${HOST}.json`);
    for (const browser of ["Google\\Chrome", "Microsoft\\Edge"]) {
      const key = `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${HOST}`;
      let output;
      try { output = register("reg.exe", ["QUERY", key, "/ve"], { windowsHide: true, encoding: "utf8", timeout: 10000 }); }
      catch { continue; }
      const registered = String(output).match(/REG_SZ\s+([^\r\n]+)/)?.[1].trim();
      if (registered !== expected) throw new Error("Another installation owns this native host; refusing to remove it.");
      register("reg.exe", ["DELETE", key, "/f"], { windowsHide: true, stdio: "pipe", timeout: 10000 });
    }
  } else {
    const file = hostLocation(platform, home);
    if (fs.existsSync(file)) {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      if (manifest.path !== path.join(directory, "native-host.sh")) throw new Error("Another installation owns this native host.");
      fs.unlinkSync(file);
    }
  }
  // Keep the directory and user files; remove only this example's live credentials.
  for (const name of ["pairing.json", "connection.json"]) fs.rmSync(path.join(directory, name), { force: true });
}

async function start({ directory = defaultDirectory(), id = DEFAULT_ID, pollMs = 250 } = {}) {
  id = extensionId(id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pairingFile = path.join(directory, "pairing.json");
  const connectionFile = path.join(directory, "connection.json");
  if (fs.existsSync(pairingFile)) throw new Error("A pairing file already exists. Stop the previous companion, or remove the stale pairing.json after checking it is no longer running.");
  const relay = new BrowserRelay({ expectedOrigin: `chrome-extension://${id}` });
  const pairing = await relay.start();
  try { fs.writeFileSync(pairingFile, JSON.stringify(pairing), { mode: 0o600, flag: "wx" }); }
  catch (error) { await relay.stop(); throw error; }
  let last = "";
  const refresh = () => {
    const browsers = relay.browsers().map((browser) => ({ ...browser, endpoint: relay.cdpUrl(browser.id) }));
    const next = JSON.stringify(browsers);
    if (next === last) return;
    last = next;
    fs.writeFileSync(connectionFile, JSON.stringify({ browsers }, null, 2), { mode: 0o600 });
  };
  refresh();
  const timer = setInterval(refresh, pollMs);
  let stopped = false;
  return { relay, pairing, connectionFile, async stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    fs.rmSync(pairingFile, { force: true });
    fs.rmSync(connectionFile, { force: true });
    await relay.stop();
  } };
}

/** A local CDP client. Agents can use this helper or Playwright connectOverCDP. */
async function demo({ directory = defaultDirectory() } = {}) {
  const WebSocket = require("ws");
  const { browsers } = JSON.parse(fs.readFileSync(path.join(directory, "connection.json"), "utf8"));
  if (!browsers.length) throw new Error("No browser connected. Open Chrome, select the example host in Connection settings, and try again.");
  const socket = new WebSocket(browsers[0].endpoint);
  let sequence = 0;
  let sessionId;
  const pending = new Map();
  socket.on("error", () => {});
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (message.method === "Target.attachedToTarget") sessionId = message.params.sessionId;
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  socket.on("close", () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Companion disconnected.")); }
    pending.clear();
  });
  const call = (method, params = {}, session) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to the companion.")), 5000);
      socket.once("open", () => { clearTimeout(timeout); resolve(); });
      socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
    });
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { result, exceptionDetails } = await call("Runtime.evaluate", {
      expression: `document.title = 'PostOrca bridge demo'; document.body.textContent = 'Your local companion is connected. No API server or AI account was used.'; document.title`,
      returnByValue: true,
    }, sessionId);
    if (exceptionDetails) throw new Error("The demo page script failed.");
    await call("Target.closeTarget", { targetId });
    return result.value;
  } finally { socket.close(); }
}

async function main(args) {
  const [command = "help", ...flags] = args;
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    if (!["--extension-id", "--data-dir"].includes(flags[i]) || !flags[i + 1]) throw new Error("Use --extension-id ID or --data-dir DIRECTORY.");
    options[flags[i] === "--extension-id" ? "id" : "directory"] = flags[i] === "--data-dir" ? path.resolve(flags[i + 1]) : flags[i + 1];
  }
  if (command === "install") {
    const result = install(options);
    console.log(`Registered ${HOST}. Select this host in the extension's Connection settings.\nManifest: ${result.manifestFile}`);
  } else if (command === "uninstall") {
    uninstall(options);
    console.log("Example native host unregistered. Select PostOrca in Connection settings to switch back.");
  } else if (command === "start") {
    const companion = await start(options);
    console.log(`Local companion running. Waiting for Chrome.\nConnection details: ${companion.connectionFile}\nTreat that file as a credential. Ctrl+C to stop.`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await companion.stop(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } else if (command === "demo") {
    console.log(await demo(options));
  } else if (command === "help") {
    console.log("PostOrca local companion example\nCommands: install, start, demo, uninstall\nOptions: --extension-id ID (use your actual Chrome extension ID), --data-dir DIRECTORY\nNo PostOrca desktop app, API server, AI key, or login required.");
  } else throw new Error(`Unknown command: ${command}`);
}

module.exports = { HOST, DEFAULT_ID, extensionId, hostLocation, quoteShell, install, uninstall, start, demo };
if (require.main === module) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
