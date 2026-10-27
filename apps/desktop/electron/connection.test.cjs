const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const http = require("node:http");
const { WebSocketServer } = require("ws");

// The connection's tools load every plugin, which needs Electron; these checks
// exercise only its sign-in and reconnect path.
for (const stub of ["./tools/index.cjs", "./plugins/computer/index.cjs"]) {
  const filename = require.resolve(stub);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: { shutdown() {} },
  };
}
const { DesktopConnection } = require("./connection.cjs");

const deviceToken = () =>
  [
    "eyJhbGciOiJIUzI1NiJ9",
    Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"),
    "signature",
  ].join(".");

/** A server that mints device tokens only for `accepted` access tokens and accepts sockets. */
async function server(accepted) {
  const requests = [];
  const sockets = [];
  const minted = new Set();
  const wss = new WebSocketServer({ noServer: true });
  const web = http.createServer((req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    requests.push(token);
    if (req.method !== "POST" || req.url !== "/api/desktop/device-token" || !accepted.has(token))
      return res.writeHead(401).end();
    const issued = deviceToken();
    minted.add(issued);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ token: issued }));
  });
  web.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/api/desktop/socket" || !minted.has(url.searchParams.get("token")))
      return socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    wss.handleUpgrade(req, socket, head, (ws) => sockets.push(ws));
  });
  await new Promise((resolve) => web.listen(0, "127.0.0.1", resolve));
  return {
    apiUrl: `http://127.0.0.1:${web.address().port}/api`,
    requests,
    sockets,
    close: () =>
      new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        web.closeAllConnections();
        web.close(resolve);
      }),
  };
}
async function until(check) {
  for (let attempt = 0; attempt < 200 && !check(); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  return check();
}

test("an expired access token is renewed once, then the desktop connects", async () => {
  const api = await server(new Set(["renewed"]));
  const session = { token: "expired", apiUrl: api.apiUrl };
  let refreshes = 0;
  // Like the main process: renews the shared session object in place.
  const refresh = async () => {
    refreshes++;
    session.token = "renewed";
    return session.token;
  };
  const connection = new DesktopConnection(randomUUID(), refresh);
  try {
    connection.setSession(session);
    assert.ok(await until(() => api.sockets.length === 1), "socket opened");
    assert.equal(refreshes, 1);
    assert.deepEqual(api.requests, ["expired", "renewed"]);
    // The minted device token is reused while it is fresh.
    assert.equal(await connection.deviceTokenFor(session), connection.deviceToken);
    assert.equal(api.requests.length, 2);
  } finally {
    connection.setSession(null);
    await api.close();
  }
});

test("a session the server ended stays offline without retrying", async () => {
  const api = await server(new Set());
  const session = { token: "expired", apiUrl: api.apiUrl };
  let refreshes = 0;
  const connection = new DesktopConnection(randomUUID(), async () => {
    refreshes++;
    return null;
  });
  try {
    connection.setSession(session);
    await until(() => refreshes === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(refreshes, 1);
    assert.deepEqual(api.requests, ["expired"]);
    assert.equal(api.sockets.length, 0);
  } finally {
    connection.setSession(null);
    await api.close();
  }
});

test("a renewed token that is still rejected is not renewed again", async () => {
  const api = await server(new Set());
  const session = { token: "expired", apiUrl: api.apiUrl };
  let refreshes = 0;
  const connection = new DesktopConnection(randomUUID(), async () => {
    refreshes++;
    session.token = "also-rejected";
    return session.token;
  });
  connection.session = session;
  try {
    assert.equal(await connection.deviceTokenFor(session), null);
    assert.equal(refreshes, 1);
    assert.deepEqual(api.requests, ["expired", "also-rejected"]);
    // A session that was replaced meanwhile is not renewed on its behalf.
    const replaced = { token: "old", apiUrl: api.apiUrl };
    assert.equal(await connection.deviceTokenFor(replaced), null);
    assert.equal(refreshes, 1);
  } finally {
    connection.setSession(null);
    await api.close();
  }
});
