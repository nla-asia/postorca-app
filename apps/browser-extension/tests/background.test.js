import { test } from "node:test";
import assert from "node:assert/strict";

test("switching companions cannot send old command results or late-created tabs to the new companion", async (t) => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (...args) => { const timer = originalTimeout(...args); timers.push(timer); return timer; };
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.setTimeout = originalTimeout;
  });
  const event = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); } });
  const localChanges = event();
  const local = {};
  const session = {};
  const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  const evaluation = deferred();
  const tabCreation = deferred();
  const removed = [];
  const hosts = [];
  globalThis.chrome = {
    storage: {
      local: { onChanged: localChanges, get: async () => local, set: async (values) => Object.assign(local, values) },
      session: { get: async () => session, set: async (values) => Object.assign(session, values) },
    },
    runtime: {
      sendNativeMessage: async (host) => { hosts.push(host); return { ok: true, port: 12345, secret: "ab".repeat(32) }; },
      getManifest: () => ({ version: "test" }), onStartup: event(), onInstalled: event(), onMessage: event(),
    },
    alarms: { create() {}, onAlarm: event() },
    tabs: {
      create: async ({ url }) => url === "https://slow.test" ? tabCreation.promise : { id: 1, windowId: 1 },
      group: async () => 1, remove: async (id) => removed.push(id), onRemoved: event(),
    },
    tabGroups: { query: async () => [], update: async () => {} },
    debugger: {
      attach: async () => {}, onEvent: event(), onDetach: event(),
      sendCommand: async (_target, method) => method === "Runtime.evaluate"
        ? evaluation.promise : { targetInfo: { targetId: "owned-target", url: "about:blank", title: "" } },
    },
  };
  const sockets = [];
  globalThis.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    messages = [];
    constructor() { sockets.push(this); }
    send(frame) { this.messages.push(JSON.parse(frame)); }
    close() { this.readyState = 3; this.onclose?.(); }
  };
  const waitFor = async (condition) => {
    for (let i = 0; i < 100 && !condition(); i++) await new Promise((resolve) => originalTimeout(resolve, 1));
    assert.ok(condition(), "expected asynchronous bridge state");
  };
  const message = (socket, data) => socket.onmessage({ data: JSON.stringify(data) });
  await import(`../background.js?test=${Date.now()}`);
  await waitFor(() => sockets.length === 1);
  const first = sockets[0];
  await message(first, { type: "accepted" });
  await message(first, { type: "createTab", seq: 1, url: "about:blank" });
  await waitFor(() => first.messages.some((m) => m.seq === 1));
  await message(first, { type: "cdp", seq: 2, tabId: 1, method: "Runtime.evaluate" });
  await message(first, { type: "createTab", seq: 3, url: "https://slow.test" });
  local.nativeHost = "com.example.other_agent";
  localChanges.listeners[0]({ nativeHost: { oldValue: "com.postorca.browser", newValue: local.nativeHost } });
  await waitFor(() => sockets.length === 2);
  const second = sockets[1];
  await message(second, { type: "accepted" });
  evaluation.resolve({ result: { value: "private result from old companion" } });
  tabCreation.resolve({ id: 99, windowId: 1 });
  await waitFor(() => removed.includes(99));
  assert.deepEqual(hosts, ["com.postorca.browser", "com.example.other_agent"]);
  assert.ok(removed.includes(1));
  assert.ok(!second.messages.some((m) => m.type === "result" || m.type === "error"));
  assert.equal(session.state.nativeHost, "com.example.other_agent");
  assert.deepEqual(session.owned, []);
});
