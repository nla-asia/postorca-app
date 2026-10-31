const { app, nativeImage } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { BrowserRelay } = require("./relay.cjs");
const { EXTENSION_ID, writePairing, removePairing } = require("./pairing.cjs");
const { TabObservations, linkTarget } = require("./observations.cjs");
const { clickElement } = require("./click.cjs");
const { pointerGlide, typeText } = require("./pointer.cjs");
const { isRecording } = require("../../tools/screen.cjs");
const { settle, trackRequests } = require("./settle.cjs");
const { pressKey } = require("./keyboard.cjs");
const { fetchBrowserFile } = require("./fetch-file.cjs");

const onCamera = pointerGlide({
  isRecording,
  loadRobot: () => require("robotjs"),
});

/**
 * The founder's own browser (Chrome, Edge, or Brave), with their real profile and
 * sign-ins, driven through the PostOrca browser extension (apps/browser-extension). Electron
 * main runs the extension's relay in-process (relay.cjs); Playwright connects to it
 * over CDP. The agent only works in tabs it opened, kept in the "Orca" tab group.
 */

// --- Relay to the PostOrca extension ------------------------------------------------------
const relay = new BrowserRelay({
  expectedOrigin: `chrome-extension://${EXTENSION_ID}`,
});
let relayStart = null;
/** Starts the relay once and publishes how the extension can reach it. */
function startRelay() {
  relayStart ??= relay.start().then(writePairing).catch(async (error) => {
    await relay.stop().catch(() => {});
    relayStart = null;
    throw error;
  });
  return relayStart;
}
/** Browsers with the extension connected on this computer: [{id, browser}] */
async function connectedBrowsers() {
  return relay.browsers();
}
async function openSession(browserId) {
  const { getChromium } = await playwriter();
  const chromium = await getChromium();
  const browser = await chromium.connectOverCDP(relay.cdpUrl(browserId));
  // Closing ends this client; the relay closes the tabs it opened.
  return { browser, close: () => browser.close().catch(() => {}) };
}
// Snapshots still use Playwriter's ARIA snapshot (and the Playwright build it ships
// with) so their format and refs stay the same.
process.env.PLAYWRITER_TELEMETRY ??= "0";
let pw = null;
async function playwriter() {
  pw ??= {
    ...(await import("playwriter")),
    ...(await import("playwriter/dist/playwright-import.js")),
  };
  return pw;
}
async function ariaSnapshot(page, interactiveOnly) {
  const { getAriaSnapshot } = await playwriter();
  return (await getAriaSnapshot({ page, interactiveOnly })).tree;
}
// -------------------------------------------------------------------------------------

/** macOS application names by the browser name the extension reports. */
const MAC_APPS = {
  Chrome: "Google Chrome",
  Edge: "Microsoft Edge",
  Brave: "Brave Browser",
};
const CONNECT_WAIT_MS = 20_000;
const TAB_IDLE_MS = 15 * 60_000;

class FounderBrowser {
  constructor() {
    this.connection = null;
    this.connecting = null;
    this.tabs = new Map(); // tab id → {page, seen: TabObservations, lastUsed}
    this.nextTab = 1;
    this.idleTimer = setInterval(() => this.closeIdleTabs(), 60_000);
    this.idleTimer.unref();
  }
  get preferenceFile() {
    return path.join(app.getPath("userData"), "browser.json");
  }
  /** The browser the extension last connected from, used to relaunch the same one. */
  get preferred() {
    try {
      return JSON.parse(fs.readFileSync(this.preferenceFile, "utf8"));
    } catch {
      return null;
    }
  }
  /** Starts listening for the extension; safe to call repeatedly. */
  start() {
    return startRelay().catch((error) => {
      console.error("PostOrca browser pairing failed:", error.message);
    });
  }
  /** Availability without launching anything (for desktop_status). */
  async status() {
    try {
      await startRelay();
      // Right after the relay starts, give a running browser a moment to reconnect.
      const browsers = await this.waitForBrowsers(3000);
      if (browsers.length)
        return { available: true, browser: browsers[0].browser };
      const name = this.launchableApp();
      return name
        ? {
            available: true,
            browser: this.preferred?.browser ?? null,
            note: `Not open right now; ${name} is opened automatically when a browser tool is used.`,
          }
        : {
            available: false,
            reason:
              "The PostOrca browser extension is not connected. The founder needs Chrome, Edge, or Brave open with the PostOrca extension installed.",
          };
    } catch (error) {
      return { available: false, reason: String(error?.message ?? error) };
    }
  }
  launchableApp() {
    if (process.platform !== "darwin") return null;
    const name = MAC_APPS[this.preferred?.browser];
    return name && fs.existsSync(`/Applications/${name}.app`) ? name : null;
  }
  async waitForBrowsers(ms) {
    const until = Date.now() + ms;
    for (;;) {
      const browsers = await connectedBrowsers();
      if (browsers.length || Date.now() >= until) return browsers;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  /** Connected Playwright browser; launches the founder's browser in the background if needed. */
  async browser() {
    if (this.connection?.browser.isConnected()) return this.connection.browser;
    this.connecting ??= this.connect().finally(() => (this.connecting = null));
    return (await this.connecting).browser;
  }
  async connect() {
    await startRelay();
    let browsers = await this.waitForBrowsers(1500);
    if (!browsers.length) {
      const name = this.launchableApp();
      if (!name)
        throw new Error(
          "The PostOrca browser extension is not connected. Ask the founder to open Chrome, Edge, or Brave with the PostOrca extension installed.",
        );
      // -g: open in the background without taking focus from the founder.
      execFile("open", ["-g", "-a", name], () => {});
      browsers = await this.waitForBrowsers(CONNECT_WAIT_MS);
      if (!browsers.length)
        throw new Error(
          `${name} was opened but the PostOrca extension did not connect. It may be disabled or not installed in this browser.`,
        );
    }
    const preferred = this.preferred;
    const target =
      browsers.find((browser) => browser.id === preferred?.id) ?? browsers[0];
    fs.writeFileSync(this.preferenceFile, JSON.stringify(target));
    const connection = { ...(await openSession(target.id)), browserId: target.id };
    connection.browser.on("disconnected", () => {
      if (this.connection === connection) this.connection = null;
      this.tabs.clear();
    });
    this.connection = connection;
    return connection;
  }
  tab(id) {
    const tab = this.tabs.get(id);
    if (!tab || tab.page.isClosed())
      throw new Error(
        `Tab ${id} is not open. Open the page again with browser_open.`,
      );
    tab.lastUsed = Date.now();
    return tab;
  }
  async open(url, newWindow = false) {
    const browser = await this.browser();
    const context = browser.contexts()[0] ?? (await browser.newContext());
    if (newWindow) relay.openNextInNewWindow(this.connection.browserId);
    const page = await context.newPage();
    const id = `t${this.nextTab++}`;
    trackRequests(page);
    const seen = new TabObservations(id);
    this.tabs.set(id, { page, seen, lastUsed: Date.now() });
    page.once("close", () => this.tabs.delete(id));
    // A new document starts a fresh baseline. In-page URL changes (pushState, which
    // single-page apps like Google Flights do on every choice) keep the same elements,
    // so their refs and the baseline stay; big changes still fall back to a full tree.
    page.on("domcontentloaded", () => seen.reset());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await settle(page);
    return { tab: id, url: page.url(), title: await page.title() };
  }
  /**
   * Accessibility tree of a tab. Repeated snapshots of the same page return only the
   * changes since the previous one (observations.cjs); full=true always returns the
   * whole tree and makes it the new baseline.
   */
  async snapshot(id, interactiveOnly, full, part) {
    const tab = this.tab(id);
    // Another part of a long result: the same observation, not a new read of the page.
    if (part)
      return {
        tab: id,
        url: tab.page.url(),
        title: await tab.page.title(),
        ...tab.seen.part(part),
      };
    tab.mode = interactiveOnly;
    const tree = await ariaSnapshot(tab.page, interactiveOnly);
    const { lines, links } = tab.seen.render(tree);
    await addLinkTargets(tab.page, lines, links);
    return {
      tab: id,
      url: tab.page.url(),
      title: await tab.page.title(),
      ...tab.seen.snapshot(lines, { interactiveOnly, full }),
    };
  }
  /**
   * The page right after an action, as a snapshot in the mode the agent last used on
   * this tab: usually only what the action changed, so acting and seeing the result
   * take one step instead of two.
   */
  async afterAction(id) {
    const tab = this.tab(id);
    try {
      return await this.snapshot(id, tab.mode ?? false, false);
    } catch (error) {
      return {
        tab: id,
        url: tab.page.url(),
        snapshot_error: `${String(error?.message ?? error).split("\n")[0]} Take a snapshot when the page has loaded.`,
      };
    }
  }
  locator(id, ref) {
    const tab = this.tab(id);
    const element = tab.seen.refs.get(ref);
    if (!element)
      throw new Error(
        `Ref ${ref} is not on tab ${id} as of its latest snapshot or labeled screenshot (the element is gone, or the page changed). Take a new snapshot.`,
      );
    return {
      page: tab.page,
      element: {
        backendNodeId: element.backendNodeId,
        locator: tab.page.locator(element.selector),
      },
    };
  }
  /**
   * JPEG of the visible area. With labels, the tab's interactive elements are observed
   * (same refs as snapshots) and the visible ones are drawn on the page for the
   * capture, then removed. It does not change the snapshot baseline.
   */
  async screenshot(id, labels) {
    const tab = this.tab(id);
    const { page } = tab;
    let visible = [];
    if (labels) {
      tab.seen.render(await ariaSnapshot(page, true));
      visible = await visibleRefs(page, tab.seen.refs);
      await page.evaluate(showLabels, visible);
    }
    try {
      const image = fitForModel(
        await page.screenshot({
          type: "jpeg",
          quality: 80,
          scale: "css",
          timeout: 20_000,
        }),
      );
      return {
        tab: id,
        url: page.url(),
        title: await page.title(),
        ...(labels
          ? { refs: visible.map(({ ref, label }) => `${ref}: ${label}`) }
          : {}),
        image,
      };
    } finally {
      if (labels)
        await page
          .evaluate(() => document.getElementById("__orca_labels")?.remove())
          .catch(() => {});
    }
  }
  async click(id, ref) {
    const { page, element } = this.locator(id, ref);
    await clickElement(page, element, onCamera);
    await settle(page);
    return this.afterAction(id);
  }
  async type(id, ref, text, submit, replace = false) {
    const { page, element } = this.locator(id, ref);
    await clickElement(page, element, onCamera);
    // Typing replaces a selection: select the field's whole content first.
    if (replace) await element.locator.selectText();
    await typeText(page, text, { isRecording });
    if (submit) await page.keyboard.press("Enter");
    await settle(page);
    return this.afterAction(id);
  }
  async press(id, key) {
    const { page } = this.tab(id);
    await pressKey(page, key);
    await settle(page);
    return this.afterAction(id);
  }
  async fetchFile(id, { url, ref, filename }, context) {
    const { page } = this.tab(id);
    if (ref) {
      const { element } = this.locator(id, ref);
      url = await element.locator.evaluate(node => node.closest("a[href]")?.href || (node instanceof HTMLImageElement ? node.currentSrc : null));
      if (!url) throw new Error("This ref has no file URL. JavaScript-only file buttons are not supported.");
    }
    const session = await page.context().getExistingCDPSession(page);
    return fetchBrowserFile(page, session, { url, filename }, context, {
      directory: path.join(app.getPath("downloads"), "PostOrca"),
    });
  }
  async scroll(id, direction) {
    const { page } = this.tab(id);
    const position = await page.evaluate((down) => {
      window.scrollBy(0, (down ? 0.85 : -0.85) * window.innerHeight);
      return {
        top: Math.round(window.scrollY),
        height: document.documentElement.scrollHeight,
      };
    }, direction !== "up");
    await settle(page);
    return { ...position, ...(await this.afterAction(id)) };
  }
  async close(id) {
    await this.tab(id).page.close();
    return { tab: id, closed: true };
  }
  async closeIdleTabs() {
    for (const [id, tab] of this.tabs)
      if (Date.now() - tab.lastUsed > TAB_IDLE_MS)
        await tab.page.close().catch(() => {});
  }
  async shutdown() {
    clearInterval(this.idleTimer);
    await this.connection?.close();
    this.connection = null;
    removePairing();
    await relay.stop();
  }
}

/** Longest edge models take without resizing; larger images only cost more tokens. */
const MAX_IMAGE_EDGE = 1568;
/**
 * Scales a screenshot down to MAX_IMAGE_EDGE as JPEG. Screenshots of the founder's
 * browser come at device resolution (2x on Retina) even with scale: "css".
 */
function fitForModel(jpeg) {
  const image = nativeImage.createFromBuffer(jpeg);
  const { width, height } = image.getSize();
  const scale = MAX_IMAGE_EDGE / Math.max(width, height);
  if (scale >= 1) return jpeg;
  return image
    .resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      quality: "best",
    })
    .toJPEG(75);
}
/** Refs whose elements are at least partly inside the viewport, with their boxes. */
async function visibleRefs(page, refs) {
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const entries = [...refs].slice(0, 400);
  const boxes = await Promise.all(
    entries.map(([, { selector }]) =>
      page
        .locator(selector)
        .first()
        .boundingBox({ timeout: 500 })
        .catch(() => null),
    ),
  );
  return entries.flatMap(([ref, { label }], index) => {
    const box = boxes[index];
    const inView =
      box &&
      box.width > 0 &&
      box.height > 0 &&
      box.x < viewport.width &&
      box.y < viewport.height &&
      box.x + box.width > 0 &&
      box.y + box.height > 0;
    return inView ? [{ ref, label, box }] : [];
  });
}
/** Runs in the page: outlines each element and tags it with its ref. */
function showLabels(labels) {
  const layer = document.createElement("div");
  layer.id = "__orca_labels";
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  for (const { ref, box } of labels) {
    const outline = document.createElement("div");
    outline.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;outline:2px solid #e6007a`;
    const tag = document.createElement("div");
    tag.textContent = ref;
    tag.style.cssText = `position:fixed;left:${Math.max(0, box.x)}px;top:${Math.max(0, box.y - 15)}px;font:bold 11px/13px monospace;padding:0 3px;background:#ffeb3b;color:#000;border:1px solid #000`;
    layer.append(outline, tag);
  }
  document.documentElement.append(layer);
}
/**
 * Appends each link's target (→ /path, or the full URL off-site) so the agent can
 * cite and open pages without clicking through them.
 */
async function addLinkTargets(page, lines, links) {
  const targets = await Promise.all(
    links.slice(0, 300).map(({ selector }) =>
      page
        .locator(selector)
        .first()
        // Generous: a target that is missing one time and present the next would show
        // up as a change.
        .getAttribute("href", { timeout: 1000 })
        .catch(() => null),
    ),
  );
  targets.forEach((href, index) => {
    const target = href && linkTarget(href, page.url());
    if (target) lines[links[index].line] += ` → ${target}`;
  });
}

module.exports = { founderBrowser: new FounderBrowser() };
