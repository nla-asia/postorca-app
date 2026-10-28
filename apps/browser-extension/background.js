// PostOrca Browser Bridge connects to the user-selected local companion through
// native messaging and forwards Chrome DevTools Protocol traffic for tabs it
// creates. The agent and automation client run in the companion, outside Chrome.

import { createScreenshotCapture } from "./capture.js";
import { DEFAULT_NATIVE_HOST, nativeHost, pairingDetails } from "./connection.js";

const captureScreenshot = createScreenshotCapture(chrome);
const GROUP_TITLE = "Orca";
// Short enough that a browser already open finds a newly started app within the
// desktop's connect wait (founder-browser.cjs).
const RECONNECT_MAX_MS = 10_000;
// High-volume events Playwright does not need; dropping them keeps the socket quiet.
const DROPPED_EVENTS = new Set([
  "Network.dataReceived",
  "Network.resourceChangedPriority",
]);

let socket = null;
let connecting = false;
let retries = 0;
let retryTimer = null;
let generation = 0;

// --- State shown in the popup and owned tabs (survive service-worker restarts) ------

async function setState(state) {
  await chrome.storage.session.set({ state });
}
// Tabs Orca opened, kept in memory so CDP events are checked (and forwarded) in order,
// and mirrored to session storage so a restarted worker still knows them.
const owned = new Set();
const ownedLoaded = chrome.storage.session
  .get("owned")
  .then(({ owned: saved = [] }) => saved.forEach((tabId) => owned.add(tabId)));
function saveOwned() {
  return chrome.storage.session.set({ owned: [...owned] });
}
function requireOwned(tabId) {
  if (!owned.has(tabId)) throw new Error(`Tab ${tabId} was not opened by Orca.`);
}
/** Stable ID for this browser profile, so the desktop can prefer the same browser. */
async function instanceId() {
  let { instanceId: id } = await chrome.storage.local.get("instanceId");
  if (!id) {
    id = crypto.randomUUID();
    await chrome.storage.local.set({ instanceId: id });
  }
  return id;
}
function browserName() {
  const brands = (navigator.userAgentData?.brands ?? []).map((b) => b.brand);
  if (brands.includes("Microsoft Edge")) return "Edge";
  if (brands.includes("Brave")) return "Brave";
  return "Chrome";
}

// --- Connection ---------------------------------------------------------------------

async function connect() {
  if (socket || connecting) return;
  connecting = true;
  const attempt = generation;
  clearTimeout(retryTimer);
  try {
    await ownedLoaded;
    const saved = await chrome.storage.local.get("nativeHost");
    const host = nativeHost(saved.nativeHost ?? DEFAULT_NATIVE_HOST);
    let pairing;
    try {
      pairing = await chrome.runtime.sendNativeMessage(host, {
        type: "pair",
      });
    } catch (error) {
      throw new Error(`Cannot reach ${host}. Start the companion or check Connection settings. Native messaging: ${error?.message ?? error}`);
    }
    if (attempt !== generation) return;
    await open(pairingDetails(pairing), host, attempt);
    retries = 0;
  } catch (error) {
    if (attempt !== generation) return;
    await setState({ connected: false, error: String(error?.message ?? error) });
    scheduleReconnect();
  } finally {
    if (attempt === generation) connecting = false;
  }
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** retries++);
  retryTimer = setTimeout(connect, delay);
}

/** Opens the relay socket and completes the challenge/proof handshake. */
function open({ port, secret }, host, attempt) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
    let ready = false;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("The local companion did not complete pairing in time."));
    }, 5000);
    ws.onmessage = async (event) => {
      if (attempt !== generation) { ws.close(); return; }
      let message;
      try { message = JSON.parse(event.data); } catch { ws.close(); return; }
      if (!ready) {
        try {
          if (message.type === "challenge") {
            ws.send(
              JSON.stringify({
                type: "proof",
                proof: await hmac(secret, message.nonce),
              }),
            );
          } else if (message.type === "accepted") {
            clearTimeout(timeout);
            ready = true;
            socket = ws;
            await closePreviousTabs();
            const id = await instanceId();
            if (attempt !== generation) { ws.close(); return; }
            ws.send(JSON.stringify({
              type: "hello",
              id,
              browser: browserName(),
              userAgent: navigator.userAgent,
              extensionVersion: chrome.runtime.getManifest().version,
            }));
            await setState({ connected: true, browser: browserName(), nativeHost: host });
            resolve();
          }
        } catch (error) {
          ws.close();
          reject(error);
        }
        return;
      }
      void handle(message, ws, attempt);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(timeout);
      if (!ready) {
        reject(new Error("The local companion refused the connection."));
        return;
      }
      if (attempt !== generation) return;
      if (socket === ws) socket = null;
      void setState({ connected: false, error: "Disconnected from the local companion." });
      scheduleReconnect();
    };
  });
}

async function hmac(secretHex, nonce) {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(secretHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(nonce),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function hexToBytes(hex) {
  return new Uint8Array(hex.match(/../g).map((pair) => parseInt(pair, 16)));
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** Tabs from an earlier connection belong to an agent session that has ended. */
async function closePreviousTabs() {
  const previous = [...owned];
  owned.clear();
  await saveOwned();
  for (const tabId of previous) await chrome.tabs.remove(tabId).catch(() => {});
}

// --- Commands from the relay --------------------------------------------------------

async function handle(message, connection, attempt) {
  const reply = (value) => {
    if (attempt === generation && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify(value));
  };
  if (message.type === "ping") {
    reply({ type: "pong" });
    return;
  }
  const { seq } = message;
  try {
    let result;
    switch (message.type) {
      case "createTab":
        result = await createTab(message.url, message.newWindow === true, attempt);
        break;
      case "closeTab":
        requireOwned(message.tabId);
        await chrome.tabs.remove(message.tabId);
        result = {};
        break;
      case "cdp":
        requireOwned(message.tabId);
        {
          const target = {
            tabId: message.tabId,
            ...(message.sessionId ? { sessionId: message.sessionId } : {}),
          };
          result = message.method === "Page.captureScreenshot"
            ? await captureScreenshot(message.tabId, target, message.params)
            : await chrome.debugger.sendCommand(target, message.method, message.params);
        }
        break;
      default:
        throw new Error(`Unknown command ${message.type}`);
    }
    reply({ type: "result", seq, result: result ?? {} });
  } catch (error) {
    reply({ type: "error", seq, message: String(error?.message ?? error) });
  }
}

/**
 * Opens a background tab in the Orca group and attaches the debugger to it. With
 * newWindow, the tab gets a window of its own (unfocused), so it is that window's
 * front tab: for screen recording without touching the founder's tabs.
 */
async function createTab(url, newWindow = false, attempt = generation) {
  let tab;
  try {
    if (newWindow) throw new Error("own window");
    tab = await chrome.tabs.create({ url, active: false });
  } catch {
    // No browser window is open (e.g. the browser was started in the background).
    const window = await chrome.windows.create({ url, focused: false });
    tab = window.tabs[0];
  }
  try {
    if (attempt !== generation) throw new Error("The companion changed while opening the tab.");
    owned.add(tab.id);
    await saveOwned();
    if (!newWindow) await addToGroup(tab);
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");
    const { targetInfo } = await chrome.debugger.sendCommand(
      { tabId: tab.id },
      "Target.getTargetInfo",
    );
    if (attempt !== generation) throw new Error("The companion changed while opening the tab.");
    return {
      tabId: tab.id,
      targetId: targetInfo.targetId,
      url: targetInfo.url,
      title: targetInfo.title,
    };
  } catch (error) {
    owned.delete(tab.id);
    await saveOwned();
    await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
}

async function addToGroup(tab) {
  const [group] = await chrome.tabGroups.query({
    title: GROUP_TITLE,
    windowId: tab.windowId,
  });
  const groupId = await chrome.tabs.group({
    tabIds: [tab.id],
    ...(group ? { groupId: group.id } : { createProperties: { windowId: tab.windowId } }),
  });
  if (!group)
    await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: "green" });
}

// --- Browser events -----------------------------------------------------------------

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (DROPPED_EVENTS.has(method) || !owned.has(source.tabId)) return;
  send({
    type: "cdpEvent",
    tabId: source.tabId,
    ...(source.sessionId ? { sessionId: source.sessionId } : {}),
    method,
    params,
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!owned.has(source.tabId)) return;
  send({ type: "detached", tabId: source.tabId, reason });
  // The founder dismissed the debugging bar: Orca can no longer use this tab.
  if (reason === "canceled_by_user") chrome.tabs.remove(source.tabId).catch(() => {});
});

// The browser may report the removal before the debugger detach, which is then no
// longer for an owned tab; report it here so the relay always hears the tab is gone.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (!owned.delete(tabId)) return;
  send({ type: "detached", tabId, reason: "target_closed" });
  void saveOwned();
});

// Reconnect when the worker starts, and check regularly in case it was idle.
chrome.alarms.create("connect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "connect") void connect();
});
chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => void connect());
chrome.storage.local.onChanged.addListener((changes) => {
  if (!changes.nativeHost) return;
  generation++;
  socket?.close();
  socket = null;
  connecting = false;
  retries = 0;
  void setState({ connected: false });
  void connect();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "reconnect") {
    retries = 0;
    void connect();
  }
});
void connect();
