// Relay and CDP bridge, end to end: Playwright → relay → a fake extension that does
// what the PostOrca extension does (tabs, chrome.debugger-style CDP) against a headless
// Chromium. Run with `npm run test:desktop`.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, after } = require("node:test");
const WebSocket = require("ws");
const { BrowserRelay } = require("./relay.cjs");

const { EXTENSION_ID } = require("./extension-id.cjs");
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
let chromium, getAriaSnapshot, context, browserWs, relay, pairing;

before(async () => {
  ({ getChromium: chromium } = await import("playwriter/dist/playwright-import.js"));
  ({ getAriaSnapshot } = await import("playwriter"));
  chromium = await chromium();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orca-relay-"));
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    // The installed browser, like the founder's; no Playwright download needed.
    channel: "chrome",
    args: ["--remote-debugging-port=0"],
  });
  const [port, wsPath] = fs
    .readFileSync(path.join(profile, "DevToolsActivePort"), "utf8")
    .trim()
    .split("\n");
  browserWs = `ws://127.0.0.1:${port}${wsPath}`;
  relay = new BrowserRelay({ expectedOrigin: ORIGIN });
  pairing = await relay.start();
});
after(async () => {
  await relay.stop();
  await context.close();
});

/** Plays the PostOrca extension: chrome.debugger is emulated with flat CDP sessions. */
async function fakeExtension({ origin = ORIGIN, secret = pairing.secret, id = "browser-1" } = {}) {
  const chrome = new WebSocket(browserWs);
  await new Promise((resolve) => chrome.once("open", resolve));
  let nextId = 1;
  const calls = new Map();
  const roots = new Map(); // root session → tabId
  const children = new Map(); // child session → tabId
  const tabs = new Map(); // tabId → {targetId, session}
  let nextTab = 1;
  const cdp = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const callId = nextId++;
      calls.set(callId, { resolve, reject });
      chrome.send(JSON.stringify({ id: callId, method, params, sessionId }));
    });
  const relaySocket = new WebSocket(`ws://127.0.0.1:${pairing.port}/extension`, { origin });
  const send = (message) => relaySocket.send(JSON.stringify(message));
  chrome.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const call = calls.get(message.id);
      calls.delete(message.id);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
      return;
    }
    const { method, params, sessionId } = message;
    if (!sessionId) {
      if (method === "Target.detachedFromTarget" && roots.has(params.sessionId)) {
        const tabId = roots.get(params.sessionId);
        roots.delete(params.sessionId);
        tabs.delete(tabId);
        send({ type: "detached", tabId, reason: "target_closed" });
      }
      return;
    }
    const tabId = roots.get(sessionId) ?? children.get(sessionId);
    if (tabId === undefined) return;
    if (method === "Target.attachedToTarget") children.set(params.sessionId, tabId);
    send({
      type: "cdpEvent",
      tabId,
      ...(roots.has(sessionId) ? {} : { sessionId }),
      method,
      params,
    });
  });
  const handle = async (message) => {
    switch (message.type) {
      case "createTab": {
        const { targetId } = await cdp("Target.createTarget", { url: message.url });
        const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
        const tabId = nextTab++;
        roots.set(sessionId, tabId);
        tabs.set(tabId, { targetId, session: sessionId });
        return { tabId, targetId, url: message.url, title: "" };
      }
      case "closeTab": {
        // Like Edge: the tab stops being owned before its debugger detach arrives,
        // so no "detached" follows a close the relay asked for.
        const { targetId, session } = tabs.get(message.tabId);
        roots.delete(session);
        tabs.delete(message.tabId);
        await cdp("Target.closeTarget", { targetId });
        return {};
      }
      case "cdp": {
        const tab = tabs.get(message.tabId);
        if (!tab) throw new Error(`Tab ${message.tabId} was not opened by Orca.`);
        return cdp(message.method, message.params, message.sessionId ?? tab.session);
      }
    }
  };
  const closed = new Promise((resolve) => relaySocket.once("close", (code) => resolve(code)));
  relaySocket.once("unexpected-response", () => relaySocket.emit("close", 403));
  relaySocket.on("error", () => {});
  relaySocket.on("message", async (data) => {
    const message = JSON.parse(String(data));
    if (message.type === "challenge") {
      const proof = crypto
        .createHmac("sha256", Buffer.from(secret, "hex"))
        .update(message.nonce)
        .digest("hex");
      send({ type: "proof", proof });
    } else if (message.type === "accepted") {
      send({ type: "hello", id, browser: "Chrome", userAgent: "test", extensionVersion: "1.0.0" });
    } else if (message.type === "ping") send({ type: "pong" });
    else
      handle(message).then(
        (result) => send({ type: "result", seq: message.seq, result }),
        (error) => send({ type: "error", seq: message.seq, message: error.message }),
      );
  });
  const close = () => {
    relaySocket.close();
    chrome.close();
  };
  return { closed, close, tabs };
}

async function waitFor(check) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(check());
}

test("rejects other origins and wrong secrets", async () => {
  const foreign = await fakeExtension({ origin: "https://example.com" });
  assert.equal(await foreign.closed, 403);
  foreign.close();
  const wrong = await fakeExtension({ secret: "00".repeat(32) });
  assert.equal(await wrong.closed, 4003);
  wrong.close();
  assert.deepEqual(relay.browsers(), []);
});

test("Playwright drives only the tabs it opens, through the extension", async () => {
  const extension = await fakeExtension();
  await waitFor(() => relay.browsers().length === 1);
  assert.deepEqual(relay.browsers(), [{ id: "browser-1", browser: "Chrome" }]);

  // Unknown tokens and sessions are refused.
  const stranger = new WebSocket(relay.cdpUrl("browser-1").replace(/cdp\/\w+/, "cdp/nope"));
  assert.equal(await new Promise((r) => stranger.once("close", r)), 4004);

  const browser = await chromium.connectOverCDP(relay.cdpUrl("browser-1"));
  const page = await browser.contexts()[0].newPage();
  assert.equal(extension.tabs.size, 1);
  await page.goto(
    "data:text/html,<title>Feed</title><button onclick=\"document.title='clicked'\">Like</button><a href='/x'>Profile</a>",
  );
  assert.equal(await page.title(), "Feed");
  const { tree } = await getAriaSnapshot({ page, interactiveOnly: true });
  assert.ok(JSON.stringify(tree).includes("Like"));
  await page.getByRole("button", { name: "Like" }).click();
  assert.equal(await page.title(), "clicked");
  const shot = await page.screenshot({ type: "jpeg" });
  assert.ok(shot.length > 0);
  await page.close();
  await waitFor(() => extension.tabs.size === 0);

  // Closing the client closes the tabs it still has open.
  await browser.contexts()[0].newPage();
  assert.equal(extension.tabs.size, 1);
  await browser.close();
  await waitFor(() => extension.tabs.size === 0);
  extension.close();
});

test("losing the extension disconnects Playwright", async () => {
  const extension = await fakeExtension({ id: "browser-2" });
  await waitFor(() => relay.browsers().some((b) => b.id === "browser-2"));
  const browser = await chromium.connectOverCDP(relay.cdpUrl("browser-2"));
  await browser.contexts()[0].newPage();
  const disconnected = new Promise((resolve) => browser.once("disconnected", resolve));
  extension.close();
  await disconnected;
  await waitFor(() => !relay.browsers().some((b) => b.id === "browser-2"));
});
