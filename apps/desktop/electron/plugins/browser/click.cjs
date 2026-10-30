/**
 * Clicking an element the agent picked by ref. A ref names the exact DOM node from the
 * accessibility tree the agent read (its backendNodeId), so the click goes to that
 * node, not to whatever a locator built from its role and name happens to match: the
 * two disagree on real pages (an <a> without href is a link to Chrome's accessibility
 * tree but not to Playwright's role matching).
 *
 * The node is scrolled into view and clicked at its center, like a person would. If
 * another element is on top there and belongs to the same component (a result card
 * whose visible content lies over its link, which is what handles the click), the
 * click goes ahead. If something else covers it (a dialog, banner, or sticky header),
 * clicking there would act on that instead, so the click fails with what is in the way.
 */

const CLICK_TIMEOUT_MS = 10_000;
const GONE_MS = 2_000;
/** How far up from the target the covering element may join it to count as the same component. */
const SAME_COMPONENT_LEVELS = 3;

const GONE =
  "That element is no longer on the page as observed (it was removed or changed). Take a new snapshot.";

/** Clicks a ref's element: by its DOM node when known, else by its locator. */
async function clickElement(page, { backendNodeId, locator }, beforeClick) {
  if (backendNodeId == null) return clickLocator(page, locator, beforeClick);
  const session = await page.context().getExistingCDPSession(page);
  let objectId;
  try {
    ({ object: { objectId } } = await session.send("DOM.resolveNode", { backendNodeId }));
  } catch {
    throw new Error(GONE);
  }
  let target;
  try {
    ({ result: { value: target } } = await session.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function (levels) { return (${coveringElement})(this, levels); }`,
      arguments: [{ value: SAME_COMPONENT_LEVELS }],
      returnByValue: true,
    }));
  } finally {
    await session.send("Runtime.releaseObject", { objectId }).catch(() => {});
  }
  await clickAt(page, target, beforeClick);
}

/** For elements without a known DOM node. */
async function clickLocator(page, locator, beforeClick) {
  // A ref whose element is gone (or whose name changed since it was observed) would
  // otherwise wait out the whole click timeout.
  try {
    await locator.waitFor({ state: "attached", timeout: GONE_MS });
  } catch (error) {
    if (!/Timeout/.test(String(error?.message))) throw error;
    throw new Error(GONE);
  }
  try {
    if (beforeClick) {
      const box = await locator.boundingBox({ timeout: GONE_MS }).catch(() => null);
      if (box) await beforeClick(page, box.x + box.width / 2, box.y + box.height / 2);
    }
    await locator.click({ timeout: CLICK_TIMEOUT_MS });
    return;
  } catch (error) {
    if (!/intercepts pointer events/.test(String(error?.message))) throw error;
  }
  await clickAt(page, await locator.evaluate(coveringElement, SAME_COMPONENT_LEVELS), beforeClick);
}

async function clickAt(page, target, beforeClick) {
  if (!target) throw new Error(GONE);
  if (target.hidden)
    throw new Error("That element is not visible on the page. Take a new snapshot or a screenshot.");
  if (!target.sameComponent)
    throw new Error(
      `The element is covered by ${target.description}. Close or dismiss that first, then take a new snapshot.`,
    );
  if (beforeClick) await beforeClick(page, target.x, target.y);
  await page.mouse.click(target.x, target.y);
}

/**
 * Runs in the page: scrolls the target into view and reports where to click it and
 * what is on top there: the target itself, part of the same component (joined within
 * `levels` ancestors of the target), or something else, described for the agent.
 */
function coveringElement(target, levels) {
  if (!target.isConnected) return null;
  target.scrollIntoView({ block: "center", inline: "center" });
  const box = target.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return { hidden: true };
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const top = document.elementFromPoint(x, y);
  if (!top) return { hidden: true };
  let ancestor = target;
  let sameComponent = target.contains(top) || top.contains(target);
  for (let i = 0; i < levels && !sameComponent && ancestor.parentElement; i++) {
    ancestor = ancestor.parentElement;
    if (ancestor === document.body) break;
    sameComponent = ancestor.contains(top);
  }
  const container = top.closest("dialog, [role=dialog], [role=alertdialog], header, nav, [role=banner]") ?? top;
  const name = (container.getAttribute("aria-label") || container.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const role = container.getAttribute("role") || container.tagName.toLowerCase();
  return { x, y, sameComponent, description: `${role}${name ? ` "${name}"` : ""}` };
}

module.exports = { clickElement };
