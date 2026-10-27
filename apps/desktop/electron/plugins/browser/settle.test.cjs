// Waiting for pages to finish reacting to an action (settle.cjs), in headless Google Chrome
// against a local server that answers slowly, like a search site applying a filter.
const assert = require("node:assert/strict");
const http = require("node:http");
const { test, before, after } = require("node:test");
const { settle, trackRequests } = require("./settle.cjs");

const PAGE = `<!doctype html><button id="filter">Hotels only</button><button id="poll">Live updates</button>
<ul id="results"><li>Capsule A</li><li>Capsule B</li></ul>
<script>
  filter.onclick = async () => {
    results.innerHTML = "";
    const items = await (await fetch("/results")).json();
    results.innerHTML = items.map((name) => "<li>" + name + "</li>").join("");
  };
  poll.onclick = () => fetch("/forever");
</script>`;

let server, base, browser, page;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/results")
      setTimeout(() => res.end(JSON.stringify(["Hotel One", "Hotel Two"])), 1500);
    else if (req.url === "/forever") req.on("close", () => {}); // never answers
    else res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const { getChromium } = await import("playwriter/dist/playwright-import.js");
  browser = await (await getChromium()).launch({ headless: true, channel: "chrome" });
  page = await browser.newPage();
  trackRequests(page);
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  server?.close();
});

test("waits for results that are fetched after the page empties its list", async () => {
  await page.goto(base);
  await page.click("#filter");
  await settle(page);
  assert.deepEqual(await page.locator("#results li").allTextContents(), ["Hotel One", "Hotel Two"]);
});

test("a request that never finishes does not hold the page past the cap", async () => {
  await page.goto(base);
  await page.click("#poll");
  const started = Date.now();
  await settle(page);
  assert.ok(Date.now() - started < 9_500);
});
