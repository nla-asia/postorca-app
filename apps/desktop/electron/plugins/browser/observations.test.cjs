// Change-aware snapshots and shared refs (observations.cjs): hand-made trees for the
// comparison rules, and real pages in headless Google Chrome for ref identity.
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { TabObservations, PART_CHARS } = require("./observations.cjs");

const node = (role, name, id, children = []) => ({
  role,
  name,
  ...(id ? { locator: `role=${role}[name="${name}"]`, backendNodeId: id } : {}),
  children,
});
const feed = (posts) => [
  node("main", "", null, [node("heading", "Home", null), ...posts]),
];
const post = (n) =>
  node("article", `Post ${n}`, null, [
    node("link", `Author ${n}`, 100 + n),
    node("button", "Like", 200 + n),
  ]);
const snap = (seen, tree, options) => seen.snapshot(seen.render(tree).lines, options);

test("first snapshot is full; an unchanged page says so", () => {
  const seen = new TabObservations("t1");
  const first = snap(seen, feed([post(1), post(2)]));
  assert.equal(first.observation, "t1:1");
  assert.equal(first.full_reason, "first snapshot of this page");
  assert.match(first.snapshot, /article "Post 2"/);
  const again = snap(seen, feed([post(1), post(2)]));
  assert.deepEqual(again, {
    observation: "t1:2",
    baseline: "t1:1",
    changes: "No changes since t1:1.",
  });
});

test("small changes come with their context and keep existing refs", () => {
  const seen = new TabObservations("t1");
  const posts = [1, 2, 3, 4, 5, 6].map(post);
  const first = snap(seen, feed(posts)).snapshot;
  const likeRef = first.match(/Post 3"\n.*\n\s+- button "Like" \[ref=(e\d+)\]/)[1];
  // A new post appears between 2 and 3, and post 5 loses its Like button.
  const changed = posts.slice();
  changed.splice(2, 0, post(9));
  changed[5] = node("article", "Post 5", null, [node("link", "Author 5", 105)]);
  const result = snap(seen, feed(changed));
  assert.equal(result.baseline, "t1:1");
  assert.equal(result.observation, "t1:2");
  const lines = result.changes.split("\n").slice(1);
  assert.deepEqual(lines, [
    '  - main',
    '+   - article "Post 9"',
    '+     - link "Author 9" [ref=e13]',
    '+     - button "Like" [ref=e14]',
    '    - article "Post 5"',
    `-     - button "Like" [ref=e10]`,
  ]);
  // Unchanged elements keep their refs; the removed button is no longer usable.
  assert.equal(seen.refs.get(likeRef).label, 'button "Like"');
  assert.equal(seen.refs.has("e10"), false);
  assert.equal(seen.refs.get("e14").label, 'button "Like"');
});

test("a new element shaped like its neighbor is shown as a whole", () => {
  const seen = new TabObservations("t1");
  const item = (text, id) =>
    node("article", "", null, [node("paragraph", "", null, [node("text", text, null)]), node("button", "Like", id)]);
  const nav = Array.from({ length: 15 }, (_, n) => node("link", `Topic ${n}`, 500 + n));
  snap(seen, [...nav, node("main", "", null, [item("Old post", 1)])]);
  const result = snap(seen, [...nav, node("main", "", null, [item("New post", 2), item("Old post", 1)])]);
  assert.deepEqual(result.changes.split("\n").slice(1), [
    "  - main",
    "+   - article",
    "+     - paragraph",
    '+       - text "New post"',
    '+     - button "Like" [ref=e17]',
  ]);
});

test("falls back to the full tree when changes are not shorter", () => {
  const seen = new TabObservations("t1");
  snap(seen, feed([1, 2, 3].map(post)));
  const result = snap(seen, feed([7, 8, 9].map(post)));
  assert.equal(result.full_reason, "too many changes");
  assert.equal(result.baseline, undefined);
  assert.match(result.snapshot, /Post 9/);
  // ...which becomes the baseline for the next comparison.
  assert.equal(snap(seen, feed([7, 8, 9].map(post))).baseline, "t1:2");
});

test("full=true returns the whole tree and resets the baseline", () => {
  const seen = new TabObservations("t1");
  snap(seen, feed([post(1)]));
  const forced = snap(seen, feed([post(1)]), { full: true });
  assert.equal(forced.full_reason, "requested");
  assert.match(forced.snapshot, /Post 1/);
  assert.equal(snap(seen, feed([post(1)])).changes, "No changes since t1:2.");
});

test("each mode compares with its own snapshots; switching loses neither", () => {
  const seen = new TabObservations("t1");
  snap(seen, feed([post(1)]));
  assert.equal(
    snap(seen, feed([post(1)]), { interactiveOnly: true }).full_reason,
    "first interactive_only snapshot of this page",
  );
  // Alternating modes, as when finding a control and then reading the page.
  for (let i = 0; i < 4; i++) {
    assert.match(snap(seen, feed([post(1)])).changes, /^No changes since t1:/);
    assert.match(snap(seen, feed([post(1)]), { interactiveOnly: true }).changes, /^No changes since t1:/);
  }
  // full=true resets only its own mode.
  snap(seen, feed([post(1)]), { full: true });
  assert.match(snap(seen, feed([post(1)]), { interactiveOnly: true }).changes, /^No changes/);
});

test("navigation and stale baselines start over", () => {
  const seen = new TabObservations("t1");
  snap(seen, feed([post(1)]), { now: 0 });
  snap(seen, feed([post(1)]), { interactiveOnly: true, now: 0 });
  assert.equal(
    snap(seen, feed([post(1)]), { interactiveOnly: true, now: 11 * 60_000 }).full_reason,
    "previous snapshot expired",
  );
  const before = [...seen.refs.keys()];
  seen.reset();
  assert.equal(seen.refs.size, 0);
  const after = snap(seen, feed([post(1)]));
  assert.equal(after.full_reason, "first snapshot of this page");
  // Refs are never reused within a tab, so a ref from the old page cannot hit a new element.
  for (const ref of seen.refs.keys()) assert.ok(!before.includes(ref));
});

test("a long page comes in parts that are views of one observation", () => {
  const seen = new TabObservations("t1");
  const filters = node("complementary", "Filters", null,
    Array.from({ length: 300 }, (_, n) => node("checkbox", `Filter option number ${n}`, 3000 + n)));
  const results = node("list", "Search results", null,
    Array.from({ length: 400 }, (_, n) => node("link", `Hotel ${n} in Shinjuku, THB ${20000 + n}`, 5000 + n)));
  const page = [node("main", "", null, [filters, results])];
  const first = snap(seen, page);
  assert.equal(first.part, 1);
  assert.ok(first.parts >= 2);
  assert.ok(first.snapshot.length <= PART_CHARS);
  // The outline says where the results are.
  assert.match(first.outline, /list "Search results": [\d,]+ chars, parts? \d/);
  // Every part together is the whole page, nothing lost; refs to any part work.
  let whole = first.snapshot;
  for (let n = 2; n <= first.parts; n++) {
    const next = seen.part(n);
    assert.equal(next.observation, first.observation);
    whole += "\n" + next.snapshot;
  }
  assert.match(whole, /Hotel 399 in Shinjuku/);
  assert.ok(seen.refs.has(whole.match(/Hotel 399[^\n]*\[ref=(e\d+)\]/)[1]));
  assert.throws(() => seen.part(first.parts + 1), /has parts 1 to/);
  // Reading parts creates no baseline: the next snapshot still diffs against the page.
  const again = snap(seen, page);
  assert.equal(again.changes, `No changes since ${first.observation}.`);
  // A page that fits is never split.
  const small = snap(new TabObservations("t2"), feed([post(1)]));
  assert.equal(small.parts, undefined);
});
// --- Real pages -------------------------------------------------------------------

let context, getAriaSnapshot;
before(async () => {
  const { getChromium } = await import("playwriter/dist/playwright-import.js");
  ({ getAriaSnapshot } = await import("playwriter"));
  const browser = await (await getChromium()).launch({ headless: true, channel: "chrome" });
  context = await browser.newContext();
});
after(() => context?.browser().close());

const tree = async (page, interactiveOnly = false) =>
  (await getAriaSnapshot({ page, interactiveOnly })).tree;

test("snapshots and labeled screenshots share refs that follow the element", async () => {
  const page = await context.newPage();
  // Enough page around the feed that one new post is a small change.
  const nav = Array.from({ length: 20 }, (_, n) => `<li><a href="/topic/${n}">Topic ${n}</a></li>`).join("");
  await page.setContent(
    `<nav><ul>${nav}</ul></nav><main><h1>Feed</h1><div id="feed">
       <article><p>First</p><button onclick="this.textContent='Liked 1'">Like</button></article>
       <article><p>Second</p><button onclick="this.textContent='Liked 2'">Like</button></article>
     </div></main>`,
  );
  const seen = new TabObservations("t1");
  const first = snap(seen, await tree(page)).snapshot;
  const [firstLike, secondLike] = [...first.matchAll(/button "Like" \[ref=(e\d+)\]/g)].map((m) => m[1]);
  // A labeled screenshot observes the interactive elements with the same refs...
  seen.render(await tree(page, true));
  assert.deepEqual(
    [...seen.refs].filter(([, { label }]) => label === 'button "Like"').map(([ref]) => ref),
    [firstLike, secondLike],
  );
  // ...without moving the snapshot baseline.
  assert.equal(snap(seen, await tree(page)).changes, "No changes since t1:1.");

  // A new post with another Like button appears above both: their nth= locators shift,
  // but each ref still points at its own button.
  await page.evaluate(() =>
    document.getElementById("feed").insertAdjacentHTML(
      "afterbegin",
      `<article><p>Newest</p><button>Like</button></article>`,
    ),
  );
  const result = snap(seen, await tree(page));
  assert.equal(result.baseline, "t1:2");
  assert.match(result.changes, /\+ .*button "Like" \[ref=e\d+\]/);
  assert.doesNotMatch(result.changes, new RegExp(`ref=${secondLike}\\]`));
  await page.locator(seen.refs.get(secondLike).selector).click();
  assert.equal(await page.locator("article").nth(2).locator("button").textContent(), "Liked 2");

  // Removing an element makes its ref unusable.
  await page.evaluate(() => document.querySelectorAll("article")[1].remove());
  const removed = snap(seen, await tree(page));
  assert.match(removed.changes, new RegExp(`- .*ref=${firstLike}\\]`));
  assert.equal(seen.refs.has(firstLike), false);
  assert.equal(seen.refs.has(secondLike), true);
  await page.close();
});

test("removals are summarized; additions are shown in full", () => {
  const seen = new TabObservations("t1");
  const nav = Array.from({ length: 30 }, (_, n) => node("link", `Topic ${n}`, 500 + n));
  // Part of the page stays visible (like Google Flights' results behind its filters).
  const results = node("list", "Results", null, Array.from({ length: 30 }, (_, n) => node("link", `Flight ${n}`, 800 + n)));
  const page = [node("banner", "", null, nav), node("main", "", null, [post(1), post(2)]), results];
  snap(seen, page);
  // A dialog opens: part of the page behind it is hidden from the tree.
  const dialog = node("dialog", "Stops", null, [node("radio", "Nonstop only", 900)]);
  const lines = snap(seen, [node("main", "", null, [dialog]), results]).changes.split("\n").slice(1);
  assert.deepEqual(lines, [
    '- - banner (and the 30 lines inside it, starting with link "Topic 0" [ref=e1])',
    "  - main",
    '+   - dialog "Stops"',
    '+     - radio "Nonstop only" [ref=e65]',
    '-   - article "Post 1"',
    '-     - link "Author 1" [ref=e31]',
    '-     - button "Like" [ref=e32]',
    '-   - article "Post 2"',
    '-     - link "Author 2" [ref=e33]',
    '-     - button "Like" [ref=e34]',
  ]);
  // A long run of removed siblings shows the first few and a count.
  const seen2 = new TabObservations("t2");
  const items = Array.from({ length: 40 }, (_, n) => node("link", `Item ${n}`, 700 + n));
  snap(seen2, [node("list", "", null, items), node("main", "", null, nav)]);
  const run = snap(seen2, [node("list", "", null, items.slice(0, 5)), node("main", "", null, nav)]);
  assert.deepEqual(run.changes.split("\n").slice(1), [
    "  - list",
    '-   - link "Item 5" [ref=e6]',
    '-   - link "Item 6" [ref=e7]',
    '-   - link "Item 7" [ref=e8]',
    "-   … and 32 more removed lines like these",
  ]);
});

test("an element rebuilt in place keeps one line, with the ref it had", () => {
  const seen = new TabObservations("t1");
  const nav = (ids) => node("navigation", "", null, ids.map((id, n) => node("link", `Section ${n}`, id)));
  const filler = Array.from({ length: 20 }, (_, n) => node("link", `Topic ${n}`, 500 + n));
  snap(seen, [nav([1, 2]), node("main", "", null, filler)]);
  const result = snap(seen, [nav([3, 4]), node("main", "", null, filler)]);
  assert.deepEqual(result.changes.split("\n").slice(1), [
    "  - navigation",
    '~   - link "Section 0" [ref=e23] (was e1)',
    '~   - link "Section 1" [ref=e24] (was e2)',
  ]);
  assert.equal(seen.refs.has("e1"), false);
});

test("lines inside a changed element are placed under its current line", () => {
  const seen = new TabObservations("t1");
  const filler = Array.from({ length: 20 }, (_, n) => node("link", `Topic ${n}`, 500 + n));
  const tab = (price) =>
    node("tablist", "", null, [node("tab", `Cheapest from ${price}`, 7, [node("text", `THB ${price}!`, null)])]);
  snap(seen, [tab(11173), node("main", "", null, filler)]);
  const result = snap(seen, [tab(15015), node("main", "", null, filler)]);
  assert.deepEqual(result.changes.split("\n").slice(1), [
    "  - tablist",
    '~   - tab "Cheapest from 15015" [ref=e1]',
    '+     - text "THB 15015!"',
    '-     - text "THB 11173!"',
  ]);
});

test("link targets leave out tracking and opaque values", () => {
  const { linkTarget } = require("./observations.cjs");
  const page = "https://www.booking.com/index.html";
  assert.equal(
    linkTarget("/searchresults.html?aid=304142&label=gen173nr-10CAEoggI46AdIMVgEaN0BiAEBmAEzuAEH&dest_id=-246227&dest_type=city&group_adults=null&nflt=", page),
    "/searchresults.html?dest_id=-246227&dest_type=city",
  );
  assert.equal(
    linkTarget("https://account.booking.com/auth/oauth2?client_id=vO1K&redirect_uri=https%3A%2F%2Fsecure.booking.com%2Flogin.html%3Fop%3Doauth_return", page),
    "https://account.booking.com/auth/oauth2?client_id=vO1K",
  );
  assert.equal(linkTarget("https://x.com/home?utm_source=a#top", "https://x.com/"), "/home#top");
  assert.equal(linkTarget("javascript:void(0)", page), null);
});
