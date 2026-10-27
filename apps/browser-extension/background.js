// PostOrca browser extension. It connects to the relay in the PostOrca desktop
// app (found through native messaging), opens tabs in its own "Orca" tab group, and
// forwards Chrome DevTools Protocol traffic for those tabs only. Everything else
// (Playwright, the agent's tools) runs in the desktop app.

import { createScreenshotCapture } from "./capture.js";

const captureScreenshot = createScreenshotCapture(chrome);
const NATIVE_HOST = "com.postorca.browser";
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
  clearTimeout(retryTimer);
  try {
    await ownedLoaded;
    let pairing;
    try {
      pairing = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
        type: "pair",
      });
    } catch (error) {
      throw new Error(`Cannot reach the PostOrca desktop app. Open or restart it, then try again. Native messaging: ${error?.message ?? error}`);
    }
    if (!pairing?.ok) throw new Error("The PostOrca desktop app is not running.");
    await open(pairing);
    retries = 0;
  } catch (error) {
    await setState({ connected: false, error: String(error?.message ?? error) });
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** retries++);
  retryTimer = setTimeout(connect, delay);
}

/** Opens the relay socket and completes the challenge/proof handshake. */
function open({ port, secret }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
    let ready = false;
    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
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
            ready = true;
            socket = ws;
            await closePreviousTabs();
            send({
              type: "hello",
              id: await instanceId(),
              browser: browserName(),
              userAgent: navigator.userAgent,
              extensionVersion: chrome.runtime.getManifest().version,
            });
            await setState({ connected: true, browser: browserName() });
            resolve();
          }
        } catch (error) {
          ws.close();
          reject(error);
        }
        return;
      }
      void handle(message);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!ready) {
        reject(new Error("The PostOrca desktop app refused the connection."));
        return;
      }
      if (socket === ws) socket = null;
      void setState({ connected: false, error: "Disconnected from the PostOrca desktop app." });
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

async function handle(message) {
  if (message.type === "ping") {
    send({ type: "pong" });
    return;
  }
  const { seq } = message;
  try {
    let result;
    switch (message.type) {
      case "createTab":
        result = await createTab(message.url, message.newWindow === true);
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
    send({ type: "result", seq, result: result ?? {} });
  } catch (error) {
    send({ type: "error", seq, message: String(error?.message ?? error) });
  }
}

/**
 * Opens a background tab in the Orca group and attaches the debugger to it. With
 * newWindow, the tab gets a window of its own (unfocused), so it is that window's
 * front tab: for screen recording without touching the founder's tabs.
 */
async function createTab(url, newWindow = false) {
  let tab;
  try {
    if (newWindow) throw new Error("own window");
    tab = await chrome.tabs.create({ url, active: false });
  } catch {
    // No browser window is open (e.g. the browser was started in the background).
    const window = await chrome.windows.create({ url, focused: false });
    tab = window.tabs[0];
  }
  owned.add(tab.id);
  await saveOwned();
  try {
    if (!newWindow) await addToGroup(tab);
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");
    const { targetInfo } = await chrome.debugger.sendCommand(
      { tabId: tab.id },
      "Target.getTargetInfo",
    );
    return {
      tabId: tab.id,
      targetId: targetInfo.targetId,
      url: targetInfo.url,
      title: targetInfo.title,
    };
  } catch (error) {
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
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "reconnect") {
    retries = 0;
    void connect();
  }
});
void connect();
