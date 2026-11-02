/** Records fixtures/evals/recordings/ledgerly-take: one long, imperfect take of the
 * Ledgerly fixture app, the way a founder might record it: dead air, a wrong click into
 * Clients, a typo fixed by hand, a long pause, then the flow to Paid. A retina-sharp
 * screencast from headless Chrome with a drawn pointer; sign-in happens off camera.
 *
 *   node scripts/evals/ledgerly-fixture.mjs prepare <attempt>   start the app on :4130
 *   node scripts/evals/recordings/record-ledgerly-take.cjs <out-folder>   writes take.mp4
 */
const { chromium } = require("@xmorse/playwright-core");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const out = process.argv[2];
const frames = path.join(out, "frames");
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });

const cursor = `
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.innerHTML = '<svg width="44" height="60" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 16 L20 16 Z" fill="#111" stroke="#fff" stroke-width="1.5"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-4px,-4px)" });
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  });`;

(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  // A retina-sharp take: the page laid out at 1440 × 900 and drawn at twice that.
  const page = await browser.newPage({ viewport: { width: 2880, height: 1800 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => addEventListener("DOMContentLoaded", () => (document.body.style.zoom = "2")));
  await page.addInitScript(cursor);
  // Sign in off camera.
  await page.goto("http://127.0.0.1:4130/?reset");
  await page.getByLabel("Email").fill("demo@ledgerly.test");
  await page.getByLabel("Password").fill("ledgerly-demo");
  await page.keyboard.press("Enter");
  await page.getByText("Revenue by month").waitFor();
  await page.mouse.move(700, 450);
  await page.waitForTimeout(500);

  const cdp = await page.context().newCDPSession(page);
  const times = [];
  cdp.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
    const file = path.join(frames, String(times.length).padStart(5, "0") + ".jpg");
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    times.push(metadata.timestamp);
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 2880, maxHeight: 1800 });
  const started = Date.now() / 1000;
  const wait = (ms) => page.waitForTimeout(ms);
  async function moveTo(locator, dx = 0, dy = 0) {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 25 });
  }
  async function click(locator) {
    await moveTo(locator);
    await wait(250);
    await locator.click();
  }
  // Dead air on the dashboard, the pointer wandering.
  await wait(2500);
  await page.mouse.move(520, 600, { steps: 40 });
  await wait(1500);
  await page.mouse.move(900, 380, { steps: 40 });
  await wait(1200);
  // A wrong click: Clients, then back to Invoices and New invoice.
  await click(page.getByRole("link", { name: "Clients" }));
  await wait(2200);
  await click(page.getByRole("link", { name: "Invoices" }));
  await wait(1500);
  await click(page.getByRole("button", { name: "New invoice" }));
  await wait(1200);
  // The client.
  const client = page.getByLabel("Client");
  await click(client);
  await wait(600);
  await client.selectOption({ label: "Juniper Studio" });
  await wait(900);
  // A typo, noticed and fixed.
  const description = page.getByLabel("Line description").first();
  await click(description);
  await description.pressSequentially("Webiste", { delay: 140 });
  await wait(1100);
  for (let i = 0; i < 4; i++) { await page.keyboard.press("Backspace"); await wait(160); }
  await description.pressSequentially("site redesign", { delay: 120 });
  await wait(500);
  const rate = page.getByLabel("Rate").first();
  await click(rate);
  await rate.pressSequentially("2400", { delay: 180 });
  await wait(2500);
  // The second line.
  await click(page.getByRole("button", { name: "+ Add line" }));
  await wait(500);
  await page.getByLabel("Line description").nth(1).pressSequentially("Copywriting", { delay: 120 });
  const qty = page.getByLabel("Quantity").nth(1);
  await click(qty);
  await qty.selectText();
  await qty.pressSequentially("4", { delay: 150 });
  const rate2 = page.getByLabel("Rate").nth(1);
  await click(rate2);
  await rate2.pressSequentially("150", { delay: 180 });
  // A long pause, looking at the total.
  await page.mouse.move(1150, 640, { steps: 30 });
  await wait(5000);
  // Save, send, get paid.
  await click(page.getByRole("button", { name: "Save draft" }));
  await wait(2200);
  await click(page.getByRole("button", { name: "Mark as sent" }));
  await wait(2600);
  await click(page.getByRole("button", { name: "Record payment" }));
  await wait(3500);
  await cdp.send("Page.stopScreencast");
  const ended = Date.now() / 1000;
  await browser.close();

  // Frames come when the page changes; each lasts until the next one.
  const list = times.map((t, i) => `file '${path.join(frames, String(i).padStart(5, "0") + ".jpg")}'\nduration ${Math.max(0.001, (times[i + 1] ?? ended) - t).toFixed(3)}`);
  list.push(`file '${path.join(frames, String(times.length - 1).padStart(5, "0") + ".jpg")}'`);
  fs.writeFileSync(path.join(out, "frames.txt"), list.join("\n"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(out, "frames.txt"),
    "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", path.join(out, "take.mp4")]);
  console.log(JSON.stringify({ frames: times.length, seconds: +(ended - (times[0] ?? started)).toFixed(1) }));
})().catch((error) => { console.error(error); process.exit(1); });
