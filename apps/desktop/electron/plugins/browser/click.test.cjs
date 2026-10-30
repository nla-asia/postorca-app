// Blocked clicks (click.cjs) on real pages in headless Google Chrome.
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { clickElement } = require("./click.cjs");

let browser, page;
before(async () => {
  const { getChromium } = await import("playwriter/dist/playwright-import.js");
  browser = await (await getChromium()).launch({ headless: true, channel: "chrome" });
  page = await browser.newPage();
});
after(() => browser?.close());

/** A ref as the tools hold it: the element's DOM node (and a locator that may not match). */
async function byNode(selector) {
  const session = await page.context().getExistingCDPSession(page);
  const { root } = await session.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  const { node } = await session.send("DOM.describeNode", { nodeId });
  return { backendNodeId: node.backendNodeId, locator: page.locator(selector) };
}

test("a link under its own card's content is clicked through the card", async () => {
  // Like a Google Flights result: the accessible link spans the row, and the row's
  // visible content (which handles clicks) lies on top of it.
  await page.setContent(`
    <div class="row" style="position:relative;width:400px;height:60px">
      <a aria-label="Flight 1, THB 25,522" href="#" style="position:absolute;inset:0"></a>
      <div class="content" onclick="document.title='opened flight 1'"
        style="position:absolute;inset:0;background:#eee">5 hr 50 min · THB 25,522</div>
    </div>`);
  await clickElement(page, await byNode("a"));
  assert.equal(await page.title(), "opened flight 1");
});

test("an unrelated overlay is not clicked; the error says what is in the way", async () => {
  await page.setContent(`
    <main><button onclick="document.title='bought'">Book</button></main>
    <div role="dialog" aria-label="Cookie consent" onclick="document.title='consent clicked'"
      style="position:fixed;inset:0;background:rgba(0,0,0,.5)">We use cookies</div>`);
  await assert.rejects(
    clickElement(page, await byNode("button")),
    /covered by dialog "Cookie consent"/,
  );
  assert.equal(await page.title(), "");
});

test("ordinary clicks are unchanged", async () => {
  await page.setContent(`<button onclick="document.title='clicked'">Go</button>`);
  await clickElement(page, await byNode("button"));
  assert.equal(await page.title(), "clicked");
});

test("a pointer glide runs before the click, at the element's center", async () => {
  await page.setContent(`<button style="position:fixed;left:100px;top:200px;width:40px;height:20px"
    onclick="document.title='clicked after'">Go</button>`);
  const seen = [];
  await clickElement(page, await byNode("button"), async (_, x, y) => {
    seen.push([x, y, await page.title()]);
  });
  assert.deepEqual(seen, [[120, 210, ""]]);
  assert.equal(await page.title(), "clicked after");
});

test("a ref whose element is gone fails fast with a clear error", async () => {
  await page.setContent(`<button>Select flight</button>`);
  const started = Date.now();
  await assert.rejects(
    clickElement(page, { locator: page.getByRole("button", { name: "From 18379 Thai baht" }) }),
    /no longer on the page as observed/,
  );
  assert.ok(Date.now() - started < 5000);
});

test("an element its role locator cannot find is clicked by its DOM node", async () => {
  // Chrome's accessibility tree calls an <a> without href a link; Playwright's role
  // matching does not, so role=link[name=...] matches nothing.
  await page.setContent(
    `<ul><li><a onclick="document.title='Terminal 21 Asok'">Nara Terminal 21 Asok</a></li></ul>`,
  );
  assert.equal(await page.getByRole("link", { name: "Nara Terminal 21 Asok" }).count(), 0);
  await clickElement(page, await byNode("a"));
  assert.equal(await page.title(), "Terminal 21 Asok");
});

test("a node that was removed is reported as gone", async () => {
  await page.setContent(`<button>Go</button>`);
  const element = await byNode("button");
  await page.evaluate(() => document.querySelector("button").remove());
  await assert.rejects(clickElement(page, element), /no longer on the page as observed/);
});
