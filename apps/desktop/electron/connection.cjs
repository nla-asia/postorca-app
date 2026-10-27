const { createReadStream } = require("node:fs");
const WebSocket = require("ws");
const tools = require("./tools/index.cjs");

// Backoff between reconnect attempts, then every 60 s while signed in.
const RECONNECT_DELAYS_MS = [1000, 8000, 16000, 32000, 48000];
const PING_MS = 30_000;
// Retry delivering a finished result on network errors; never re-run the tool.
const RESULT_RETRY_DELAYS_MS = [1000, 3000, 10000];
// The device token is minted again when it has less than this left.
const DEVICE_TOKEN_MARGIN_MS = 5 * 60_000;

/**
 * The desktop's live connection to the server, owned by the main process so it
 * keeps working with the window closed. The server sends desktop tool calls over
 * the WebSocket; results go back over HTTP with this device's token.
 */
class DesktopConnection {
  /**
   * refresh() renews the session's access token in place and resolves to it (null
   * when the server ended the session). onNotification({title, body, taskId?}): the
   * server asks to show one (work finished).
   */
  constructor(deviceId, refresh = async () => null, onNotification = () => {}) {
    this.deviceId = deviceId;
    this.refresh = refresh;
    this.onNotification = onNotification;
    this.session = null;
    this.deviceToken = null;
    this.deviceTokenExpiresAt = 0;
    this.socket = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }
  /** Connect for a session ({token, apiUrl}); null disconnects. */
  setSession(session) {
    this.session = session;
    this.deviceToken = null;
    this.reconnectAttempts = 0;
    this.teardown();
    if (session) void this.connect();
  }
  teardown() {
    require("./plugins/computer/index.cjs").shutdown();
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.reconnectTimer = this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners();
    socket?.on("error", () => {});
    socket?.close();
  }
  /**
   * This device's token for the session: the server binds this device's identity
   * into a token of its own, minted again with the session token when it nears
   * expiry. An expired access token is renewed once; null when the session was
   * rejected; throws when offline.
   */
  async deviceTokenFor(session) {
    if (
      session === this.session &&
      this.deviceToken &&
      this.deviceTokenExpiresAt - Date.now() > DEVICE_TOKEN_MARGIN_MS
    )
      return this.deviceToken;
    for (let renewed = false; ; renewed = true) {
      const response = await fetch(`${session.apiUrl}/desktop/device-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ deviceId: this.deviceId }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401) {
        if (!renewed && session === this.session && (await this.refresh()))
          continue;
        return null;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { token } = await response.json();
      if (session === this.session) {
        const { exp } = JSON.parse(
          Buffer.from(token.split(".")[1], "base64url").toString(),
        );
        this.deviceToken = token;
        this.deviceTokenExpiresAt = exp * 1000;
      }
      return token;
    }
  }
  async connect() {
    const session = this.session;
    let deviceToken;
    try {
      deviceToken = await this.deviceTokenFor(session);
      // Rejected session: stay offline until the app signs in again.
      if (!deviceToken) return;
    } catch {
      return this.reconnect(session);
    }
    if (session !== this.session) return;
    const url = `${session.apiUrl.replace(/^http/, "ws")}/desktop/socket?token=${encodeURIComponent(deviceToken)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.on("open", () => {
      this.reconnectAttempts = 0;
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.ping();
      }, PING_MS);
    });
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === "desktop_tool_execution")
        void this.execute(session, message.data);
      else if (message.type === "notification")
        this.onNotification(message.data);
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (socket === this.socket)
        require("./plugins/computer/index.cjs").shutdown();
      clearInterval(this.pingTimer);
      if (socket === this.socket) this.reconnect(session);
    });
  }
  reconnect(session) {
    if (session !== this.session) return;
    clearTimeout(this.reconnectTimer);
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempts++] ?? 60_000;
    this.reconnectTimer = setTimeout(() => {
      if (session === this.session) void this.connect();
    }, delay);
  }
  /** Authorization header for a request on this device's behalf. */
  async authorization(session) {
    const token = await this.deviceTokenFor(session);
    if (!token) throw new Error("Signed out of this computer.");
    return `Bearer ${token}`;
  }
  /**
   * Stores an image, MP3 or MP4 on the server; returns its file key for the tool
   * result. Allows 30 s plus 1 s per MB.
   */
  async upload(session, data, type) {
    const response = await fetch(`${session.apiUrl}/desktop/files`, {
      method: "POST",
      headers: {
        "Content-Type": type,
        Authorization: await this.authorization(session),
      },
      body: data,
      signal: AbortSignal.timeout(30_000 + Math.ceil(data.length / 1000)),
    });
    if (!response.ok) throw new Error(`Upload failed: HTTP ${response.status}`);
    return (await response.json()).file;
  }
  /** Reads one of the founder's saved files by key: {data, type}. */
  async download(session, key) {
    const response = await fetch(
      `${session.apiUrl}/desktop/files?key=${encodeURIComponent(key)}`,
      {
        headers: { Authorization: await this.authorization(session) },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok)
      throw new Error(`Download failed: HTTP ${response.status}`);
    return {
      data: Buffer.from(await response.arrayBuffer()),
      type: (response.headers.get("content-type") ?? "").split(";")[0],
    };
  }
  /**
   * Streams a local file to the founder's saved downloads, unchanged, with its
   * metadata ({filename, source_url?, download_url?, final_url?, reported_type?}).
   * Returns the saved file's key, detected type, size and checksum.
   */
  async uploadFile(session, filename, metadata, signal) {
    const authorization = await this.authorization(session);
    const stream = createReadStream(filename);
    try {
      const response = await fetch(`${session.apiUrl}/desktop/downloads`, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/octet-stream",
          "X-PostOrca-File": encodeURIComponent(JSON.stringify(metadata)),
        },
        body: stream,
        duplex: "half",
        signal,
      });
      if (!response.ok)
        throw new Error(
          `File import failed: HTTP ${response.status} ${await response.text()}`,
        );
      return await response.json();
    } finally {
      stream.destroy();
    }
  }
  async execute(session, call) {
    let body;
    let timer;
    // Aborted when the call times out, so long-running tools can stop their work.
    const controller = new AbortController();
    try {
      if (!Object.hasOwn(tools, call.tool))
        throw new Error("This desktop app does not implement that tool.");
      const result = await Promise.race([
        tools[call.tool].run(call.arguments ?? {}, {
          tools: Object.keys(tools),
          taskId: call.taskId,
          turnId: call.turnId,
          upload: (data, type) => this.upload(session, data, type),
          download: (key) => this.download(session, key),
          uploadFile: (filename, metadata, signal) =>
            this.uploadFile(session, filename, metadata, signal),
          signal: controller.signal,
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Timed out on the desktop."));
          }, call.timeoutMs);
        }),
      ]);
      body = {
        executionId: call.executionId,
        ok: true,
        result: result ?? null,
      };
    } catch (error) {
      body = {
        executionId: call.executionId,
        ok: false,
        error: String(error?.message ?? error).slice(0, 2000),
      };
    } finally {
      clearTimeout(timer);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        // 204 delivered; 404 means the server stopped waiting. Either way, done.
        await fetch(`${session.apiUrl}/desktop/tool-result`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: await this.authorization(session),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        return;
      } catch {
        const delay = RESULT_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) return;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
module.exports = { DesktopConnection };
