// Sign-in renewal in the interface's API client, loaded through Vite like the app.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite;
before(async () => {
  vite = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../../", import.meta.url)),
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
});
after(async () => {
  await vite?.close();
  delete globalThis.window;
  delete globalThis.sessionStorage;
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}
/** A fresh copy of src/lib/api.ts in a window with `bridge` (the desktop) or without it (a browser). */
async function loadApi(bridge) {
  globalThis.window = bridge ? { postorca: bridge } : {};
  globalThis.sessionStorage = memoryStorage();
  vite.moduleGraph.invalidateAll();
  return vite.ssrLoadModule("/src/lib/api.ts");
}
/** fetch that answers by access token; records each request's path and token. */
function serve(tokens, handlers = {}) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(/^\/api/, "");
    const token = (init.headers?.Authorization ?? "").replace(/^Bearer /, "");
    requests.push({ path, token, body: init.body ?? null });
    if (handlers[path]) return handlers[path](init);
    return tokens.has(token)
      ? Response.json({ ok: true })
      : Response.json({ error: "Your session has expired." }, { status: 401 });
  };
  return requests;
}
function desktopBridge(refreshed) {
  const calls = { refresh: 0, clear: 0 };
  return {
    calls,
    session: {
      get: async () => "expired",
      set: async () => {},
      refresh: async () => {
        calls.refresh++;
        return refreshed;
      },
      clear: async () => {
        calls.clear++;
      },
    },
  };
}

test("on the desktop, an expired access token is renewed by the main process", async () => {
  const bridge = desktopBridge("renewed");
  const { api, tokenStore } = await loadApi(bridge);
  await tokenStore.load();
  const requests = serve(new Set(["renewed"]));
  assert.deepEqual(await api("/tasks"), { ok: true });
  assert.equal(bridge.calls.refresh, 1);
  assert.equal(bridge.calls.clear, 0);
  assert.equal(tokenStore.get(), "renewed");
  // The window never spends the refresh token itself.
  assert.deepEqual(
    requests.map(({ path, token }) => [path, token]),
    [
      ["/tasks", "expired"],
      ["/tasks", "renewed"],
    ],
  );
});

test("on the desktop, a session the server ended still signs out", async () => {
  const bridge = desktopBridge(null);
  const { api, tokenStore, onUnauthorized, ApiError } = await loadApi(bridge);
  await tokenStore.load();
  const messages = [];
  onUnauthorized((message) => messages.push(message));
  serve(new Set());
  await assert.rejects(api("/tasks"), (error) => error instanceof ApiError && error.status === 401);
  assert.equal(bridge.calls.refresh, 1);
  assert.equal(bridge.calls.clear, 1);
  assert.equal(tokenStore.get(), null);
  assert.deepEqual(messages, ["Your session has expired."]);
});

test("in a browser, the window renews with its own refresh token", async () => {
  const { api, tokenStore } = await loadApi(null);
  tokenStore.set({ token: "expired", refreshToken: "refresh-1" });
  const requests = serve(new Set(["renewed"]), {
    "/auth/refresh": async (init) => {
      assert.deepEqual(JSON.parse(init.body), { refreshToken: "refresh-1" });
      return Response.json({ token: "renewed", refreshToken: "refresh-2" });
    },
  });
  assert.deepEqual(await api("/tasks"), { ok: true });
  assert.equal(tokenStore.get(), "renewed");
  assert.equal(sessionStorage.getItem("postorca-refresh-token"), "refresh-2");
  assert.deepEqual(
    requests.map(({ path }) => path),
    ["/tasks", "/auth/refresh", "/tasks"],
  );
});
