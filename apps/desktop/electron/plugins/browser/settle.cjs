/**
 * Waiting for a page to finish reacting to an action before reading it. Client-rendered
 * pages (feeds, search results, filters) often clear content, fetch, and render again;
 * between those steps the page can hold still for a second, so a steady page alone is
 * not enough. The page counts as settled when, together:
 * - its own data and document requests have finished, with none for QUIET_MS;
 * - nothing visible is marked loading (progressbar, aria-busy);
 * - its element count stopped changing.
 * Capped at MAX_MS: pages with endless background requests are read as they are then.
 */

const MAX_MS = 8_000;
const QUIET_MS = 500;
const POLL_MS = 250;
/** Request types the page's own content depends on (not images, fonts, or beacons). */
const CONTENT_TYPES = new Set(["document", "fetch", "xhr"]);

const activity = new WeakMap(); // page → {pending: Set<request>, lastChange}

/** Starts following a page's requests; call once, before any action on it. */
function trackRequests(page) {
  const state = { pending: new Set(), lastChange: Date.now() };
  activity.set(page, state);
  const done = (request) => {
    if (state.pending.delete(request)) state.lastChange = Date.now();
  };
  page.on("request", (request) => {
    if (!CONTENT_TYPES.has(request.resourceType())) return;
    state.pending.add(request);
    state.lastChange = Date.now();
  });
  page.on("requestfinished", done);
  page.on("requestfailed", done);
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const requests = activity.get(page);
  const until = Date.now() + MAX_MS;
  let last = -1;
  let stable = 0;
  while (Date.now() < until) {
    await page.waitForTimeout(POLL_MS);
    const state = await page
      .evaluate(() => ({
        size: document.body?.getElementsByTagName("*").length ?? 0,
        loading: [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(
          (element) => element.getBoundingClientRect().height > 0,
        ),
      }))
      .catch(() => null);
    if (!state) break; // navigated away mid-check
    stable = !state.loading && state.size === last ? stable + 1 : 0;
    last = state.size;
    const quiet =
      !requests || (requests.pending.size === 0 && Date.now() - requests.lastChange >= QUIET_MS);
    if (quiet && stable >= 3) break;
  }
}

module.exports = { settle, trackRequests };
