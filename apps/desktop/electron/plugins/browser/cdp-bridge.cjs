/**
 * A browser-level CDP endpoint for Playwright's connectOverCDP, built on the
 * extension's per-tab chrome.debugger access. The extension can only reach tabs; the
 * bridge answers the browser-level Target.* and Browser.* commands Playwright sends
 * itself, exposes only the tabs this client created, and routes session-scoped
 * commands and events between Playwright and those tabs. Modeled on OpenClaw's
 * extension relay bridge (MIT), narrowed to one client that only uses its own tabs.
 */

const BROWSER_TARGET_ID = "orca-browser";
// Playwright requires attached pages to name a browser context; it maps any unknown
// one to the default (persistent) context of the connection.
const BROWSER_CONTEXT_ID = "orca-context";
const RUNTIME_READY_MS = 3_000;

class CdpBridge {
  constructor(extension, socket) {
    this.extension = extension;
    this.socket = socket;
    this.tabs = new Map(); // tabId → {targetId, sessionId, url, title}
    this.sessions = new Map(); // CDP session id → {tabId, child: chrome session id?}
    this.runtimeWaiters = new Map(); // session id → resolve(), for Runtime.enable
    this.closed = false;
    socket.on("message", (data) => {
      let request;
      try {
        request = JSON.parse(String(data));
      } catch {
        return;
      }
      if (typeof request.id !== "number" || typeof request.method !== "string")
        return;
      this.handle(request).then(
        (result) => this.reply(request, { result: result ?? {} }),
        (error) =>
          this.reply(request, {
            error: { code: -32000, message: String(error?.message ?? error) },
          }),
      );
    });
    socket.on("close", () => this.close());
  }

  send(message) {
    if (!this.closed) this.socket.send(JSON.stringify(message));
  }
  reply(request, payload) {
    this.send({
      id: request.id,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...payload,
    });
  }
  targetInfo(tab) {
    return {
      targetId: tab.targetId,
      type: "page",
      title: tab.title,
      url: tab.url,
      attached: true,
      canAccessOpener: false,
      browserContextId: BROWSER_CONTEXT_ID,
    };
  }

  async handle({ method, params = {}, sessionId }) {
    if (sessionId) return this.forward(sessionId, method, params);
    switch (method) {
      case "Browser.getVersion":
        return {
          protocolVersion: "1.3",
          product: this.extension.browser,
          revision: "orca-extension",
          userAgent: this.extension.userAgent,
          jsVersion: "",
        };
      // Browser-wide settings chrome.debugger cannot reach. Pages created later are
      // reported through Target.attachedToTarget, so there is nothing to discover.
      case "Browser.setDownloadBehavior":
      case "Target.setAutoAttach":
      case "Target.setDiscoverTargets":
        return {};
      case "Target.getBrowserContexts":
        return { browserContextIds: [] };
      case "Target.getTargets":
        return { targetInfos: [...this.tabs.values()].map((tab) => this.targetInfo(tab)) };
      case "Target.getTargetInfo": {
        const tab = this.byTarget(params.targetId);
        if (tab) return { targetInfo: this.targetInfo(tab) };
        return {
          targetInfo: {
            targetId: BROWSER_TARGET_ID,
            type: "browser",
            title: "",
            url: "",
            attached: true,
            canAccessOpener: false,
          },
        };
      }
      case "Target.createTarget":
        return this.createTarget(params.url || "about:blank");
      case "Target.closeTarget": {
        const tab = this.byTarget(params.targetId);
        if (!tab) throw new Error(`No target with given id found: ${params.targetId}`);
        await this.extension.call({ type: "closeTab", tabId: tab.tabId });
        // Playwright's page.close() waits for the detach; don't depend on the
        // extension's event for it. A later "detached" for this tab is ignored.
        if (this.tabs.get(tab.tabId) === tab) this.dropTab(tab);
        return { success: true };
      }
      case "Browser.close":
        // Never close the founder's browser: end this automation client only.
        setImmediate(() => this.socket.close(1000, "Browser.close"));
        return {};
      default:
        throw new Error(`'${method}' is not available in the founder's browser.`);
    }
  }

  byTarget(targetId) {
    return [...this.tabs.values()].find((tab) => tab.targetId === targetId);
  }

  /** Opens a tab in the founder's browser and announces it before replying, as Chrome does. */
  async createTarget(url) {
    // Set by openNextInNewWindow for one tab: Playwright's newPage can't ask for it.
    const newWindow = this.newWindowOnce === true;
    this.newWindowOnce = false;
    const created = await this.extension.call({ type: "createTab", url, newWindow });
    if (this.closed) {
      await this.extension.call({ type: "closeTab", tabId: created.tabId }).catch(() => {});
      throw new Error("The connection closed.");
    }
    const tab = {
      tabId: created.tabId,
      targetId: created.targetId,
      sessionId: `orca-tab-${created.tabId}`,
      url: created.url ?? url,
      title: created.title ?? "",
    };
    this.tabs.set(tab.tabId, tab);
    this.sessions.set(tab.sessionId, { tabId: tab.tabId });
    this.send({
      method: "Target.attachedToTarget",
      params: {
        sessionId: tab.sessionId,
        targetInfo: this.targetInfo(tab),
        waitingForDebugger: false,
      },
    });
    return { targetId: tab.targetId };
  }

  async forward(sessionId, method, params) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const command = this.extension.call({
      type: "cdp",
      tabId: session.tabId,
      ...(session.child ? { sessionId: session.child } : {}),
      method,
      params,
    });
    if (method !== "Runtime.enable") return command;
    // Playwright treats a page as ready once its main-world context exists; wait for
    // it like a browser does, but never longer than RUNTIME_READY_MS.
    const ready = new Promise((resolve) => {
      this.runtimeWaiters.set(sessionId, resolve);
      setTimeout(resolve, RUNTIME_READY_MS).unref();
    });
    const result = await command;
    await ready;
    this.runtimeWaiters.delete(sessionId);
    return result;
  }

  /** Events and detaches from the extension, for this client's tabs only. */
  receive(message) {
    const tab = this.tabs.get(message.tabId);
    if (!tab) return;
    if (message.type === "detached") {
      this.dropTab(tab);
      return;
    }
    const { method, params } = message;
    const sessionId = message.sessionId ?? tab.sessionId;
    // Child targets (iframes, workers) the page auto-attaches use Chrome's own
    // session ids, which chrome.debugger accepts directly.
    if (method === "Target.attachedToTarget")
      this.sessions.set(params.sessionId, { tabId: tab.tabId, child: params.sessionId });
    else if (method === "Target.detachedFromTarget") this.sessions.delete(params.sessionId);
    else if (method === "Target.targetInfoChanged" && !message.sessionId && params.targetInfo?.targetId === tab.targetId) {
      tab.url = params.targetInfo.url;
      tab.title = params.targetInfo.title;
    } else if (method === "Runtime.executionContextCreated" && params.context?.auxData?.isDefault)
      this.runtimeWaiters.get(sessionId)?.();
    this.send({ method, params, sessionId });
  }

  dropTab(tab) {
    this.tabs.delete(tab.tabId);
    for (const [id, session] of this.sessions)
      if (session.tabId === tab.tabId) this.sessions.delete(id);
    this.send({
      method: "Target.detachedFromTarget",
      params: { sessionId: tab.sessionId, targetId: tab.targetId },
    });
  }

  /** Ends this client and closes the tabs it opened, like closing an automation browser. */
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.extension.bridge === this) this.extension.bridge = null;
    for (const resolve of this.runtimeWaiters.values()) resolve();
    for (const tab of this.tabs.values())
      this.extension.call({ type: "closeTab", tabId: tab.tabId }).catch(() => {});
    this.tabs.clear();
    if (this.socket.readyState <= 1) this.socket.close(1001, "Browser disconnected");
  }
}

module.exports = { CdpBridge };
