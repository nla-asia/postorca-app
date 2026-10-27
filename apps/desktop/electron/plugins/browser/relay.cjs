const crypto = require("node:crypto");
const http = require("node:http");
const { WebSocketServer } = require("ws");
const { CdpBridge } = require("./cdp-bridge.cjs");

/**
 * Loopback relay between the PostOrca browser extension and Playwright. Two endpoints:
 *   /extension   the extension connects here and proves it holds the pairing secret
 *                (HMAC of a fresh nonce); only PostOrca's extension origin is accepted.
 *   /cdp/<token> Playwright's connectOverCDP endpoint for one connected browser;
 *                the token is random per start and never leaves this process.
 * Wire protocol (JSON messages):
 *   relay → extension: challenge, accepted, ping,
 *                      {seq, type: createTab|closeTab|cdp, ...}
 *   extension → relay: proof, hello, pong, result/error {seq},
 *                      cdpEvent {tabId, sessionId?, method, params},
 *                      detached {tabId, reason}
 */

const AUTH_TIMEOUT_MS = 5_000;
const PING_MS = 20_000;
const COMMAND_TIMEOUT_MS = 60_000;

/** One authenticated extension (one browser profile). */
class ExtensionConnection {
  constructor(socket, hello) {
    this.socket = socket;
    this.id = hello.id;
    this.browser = hello.browser;
    this.userAgent = hello.userAgent;
    this.pending = new Map();
    this.nextSeq = 1;
    this.bridge = null;
    this.missedPongs = 0;
  }
  call(command) {
    const seq = this.nextSeq++;
    if (this.socket.readyState !== 1)
      return Promise.reject(new Error("The browser extension disconnected."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`The browser did not answer ${command.method ?? command.type}.`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(seq, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ ...command, seq }));
    });
  }
  receive(message) {
    switch (message.type) {
      case "result":
      case "error": {
        const pending = this.pending.get(message.seq);
        if (!pending) return;
        this.pending.delete(message.seq);
        clearTimeout(pending.timer);
        if (message.type === "result") pending.resolve(message.result);
        else pending.reject(new Error(message.message));
        return;
      }
      case "pong":
        this.missedPongs = 0;
        return;
      case "cdpEvent":
      case "detached":
        this.bridge?.receive(message);
    }
  }
  gone() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("The browser extension disconnected."));
    }
    this.pending.clear();
    this.bridge?.close();
  }
}

class BrowserRelay {
  /** @param {{expectedOrigin: string}} options */
  constructor({ expectedOrigin }) {
    this.expectedOrigin = expectedOrigin;
    this.secret = crypto.randomBytes(32).toString("hex");
    this.token = crypto.randomBytes(16).toString("hex");
    this.extensions = new Map(); // id → ExtensionConnection
    this.server = null;
    this.port = null;
  }
  async start() {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
    this.server = http.createServer((_req, res) => res.writeHead(404).end());
    this.server.on("upgrade", (req, socket, head) => {
      const { pathname } = new URL(req.url, "http://127.0.0.1");
      if (pathname === "/extension" && req.headers.origin === this.expectedOrigin)
        wss.handleUpgrade(req, socket, head, (ws) => this.acceptExtension(ws));
      else if (pathname.startsWith("/cdp/") && !req.headers.origin)
        wss.handleUpgrade(req, socket, head, (ws) =>
          this.acceptCdp(ws, pathname.slice("/cdp/".length)),
        );
      else socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.port = this.server.address().port;
    this.pingTimer = setInterval(() => this.ping(), PING_MS);
    this.pingTimer.unref();
    return { port: this.port, secret: this.secret };
  }
  /** Connected browsers: [{id, browser}] */
  browsers() {
    return [...this.extensions.values()].map(({ id, browser }) => ({ id, browser }));
  }
  /** The next tab the automation client opens in this browser gets its own window. */
  openNextInNewWindow(browserId) {
    const bridge = this.extensions.get(browserId)?.bridge;
    if (!bridge) throw new Error("The browser is not connected.");
    bridge.newWindowOnce = true;
  }
  /** Playwright endpoint for one connected browser. */
  cdpUrl(browserId) {
    return `ws://127.0.0.1:${this.port}/cdp/${this.token}/${encodeURIComponent(browserId)}`;
  }
  acceptExtension(ws) {
    const nonce = crypto.randomBytes(32).toString("hex");
    const expected = crypto.createHmac("sha256", Buffer.from(this.secret, "hex")).update(nonce).digest();
    let connection = null;
    let proven = false;
    const timer = setTimeout(() => ws.close(4001, "Authentication timed out"), AUTH_TIMEOUT_MS);
    ws.send(JSON.stringify({ type: "challenge", nonce }));
    ws.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return ws.close(4002, "Malformed message");
      }
      if (connection) return connection.receive(message);
      if (!proven) {
        const proof = Buffer.from(typeof message.proof === "string" ? message.proof : "", "hex");
        if (message.type !== "proof" || proof.length !== expected.length || !crypto.timingSafeEqual(proof, expected))
          return ws.close(4003, "Invalid proof");
        proven = true;
        ws.send(JSON.stringify({ type: "accepted" }));
        return;
      }
      if (message.type !== "hello" || typeof message.id !== "string")
        return ws.close(4002, "Expected hello");
      clearTimeout(timer);
      // A restarted extension worker replaces its earlier connection.
      const previous = this.extensions.get(message.id);
      if (previous) {
        this.extensions.delete(message.id);
        previous.gone();
        previous.socket.close(4000, "Replaced by a newer connection");
      }
      connection = new ExtensionConnection(ws, message);
      this.extensions.set(connection.id, connection);
    });
    ws.on("close", () => {
      clearTimeout(timer);
      if (connection && this.extensions.get(connection.id) === connection) {
        this.extensions.delete(connection.id);
        connection.gone();
      }
    });
  }
  acceptCdp(ws, rest) {
    const [token, id] = rest.split("/");
    const extension = this.extensions.get(decodeURIComponent(id ?? ""));
    if (token !== this.token || !extension) return ws.close(4004, "Unknown browser");
    // One automation client per browser; a new one takes over.
    extension.bridge?.close();
    extension.bridge = new CdpBridge(extension, ws);
  }
  ping() {
    for (const connection of this.extensions.values()) {
      // An open socket can outlive a stopped extension worker; only pongs prove it is alive.
      if (++connection.missedPongs > 2) connection.socket.terminate();
      else connection.socket.send(JSON.stringify({ type: "ping" }));
    }
  }
  async stop() {
    clearInterval(this.pingTimer);
    for (const connection of this.extensions.values()) {
      connection.gone();
      connection.socket.close(1001, "PostOrca is closing");
    }
    this.extensions.clear();
    await new Promise((resolve) => (this.server ? this.server.close(resolve) : resolve()));
  }
}

module.exports = { BrowserRelay };
