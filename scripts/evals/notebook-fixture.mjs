/** Deterministic local quote fixture. Observer commands never submit the form.
 * Usage: node notebook-fixture.mjs prepare|observe|cleanup <attempt-folder>
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, open, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const [phase, folder] = process.argv.slice(2);
if (!folder || !["prepare", "serve", "observe", "cleanup"].includes(phase))
  throw new Error("Expected phase and attempt folder");
const ownerFile = join(folder, "notebook-owner.json");
const eventsFile = join(folder, "notebook-events.json");
const base = "http://127.0.0.1:4107";
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = async (file, data) =>
  writeFile(file, JSON.stringify(data, null, 2));

if (phase === "serve") {
  const owner = await read(ownerFile);
  const events = [];
  const page = (body) =>
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Notebook Studio — Quote</title><style>body{font:20px system-ui;max-width:680px;margin:60px auto;background:#f8f7f2;color:#21342c}main{background:white;padding:36px;border-radius:16px}input,button{font:inherit;padding:10px;margin:10px 0}button{background:#234e3b;color:white;border:0;border-radius:6px}dt{font-weight:600}dd{margin:0 0 20px}</style><main><h1>Notebook Studio</h1><p>Plan your next project with our A5 dot-grid notebooks.</p><p>Notebook: USD 19.50 each. Flat shipping: USD 4.25.</p>${body}<p>This page provides a quote only. No order or payment is placed.</p></main></html>`;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/__owner") {
        if (req.headers["x-fixture-owner"] !== owner.nonce) {
          res.writeHead(403).end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ready: true }));
        return;
      }
      if (req.url === "/__stop" && req.method === "POST") {
        if (req.headers["x-fixture-owner"] !== owner.nonce) {
          res.writeHead(403).end();
          return;
        }
        res.end("stopping");
        server.close(() => process.exit(0));
        return;
      }
      let body =
        '<h2>Calculate your quote</h2><form action="/quote" method="post"><label for="quantity">Quantity</label><br><input id="quantity" name="quantity" type="number" min="1" max="100" value="1" required><br><button type="submit">Calculate quote</button></form>';
      if (req.url === "/quote" && req.method === "POST") {
        let input = "";
        for await (const chunk of req) {
          input += chunk;
          if (input.length > 1024) throw new Error("Request too large");
        }
        const quantity = Number(new URLSearchParams(input).get("quantity"));
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
          res.writeHead(400).end("Choose a whole quantity from 1 to 100");
          return;
        }
        const subtotal = quantity * 19.5,
          shipping = 4.25,
          total = subtotal + shipping;
        const quote = { quantity, subtotal, shipping, total };
        events.push({ at: new Date().toISOString(), quote });
        await save(eventsFile, events);
        body = `<h2>Your quote</h2><dl><dt>Quantity</dt><dd>${quantity}</dd><dt>Subtotal</dt><dd>USD ${subtotal.toFixed(2)}</dd><dt>Shipping</dt><dd>USD ${shipping.toFixed(2)}</dd><dt>Total</dt><dd>USD ${total.toFixed(2)}</dd></dl><a href="/">New quote</a>`;
      } else if (req.url !== "/" && req.url !== "/favicon.ico") {
        res.writeHead(404).end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(page(body));
    } catch {
      res.writeHead(500).end("Quote could not be calculated");
    }
  });
  server.listen(4107, "127.0.0.1");
} else if (phase === "prepare") {
  let occupied = false;
  try {
    await fetch(base, { signal: AbortSignal.timeout(1000) });
    occupied = true;
  } catch {}
  if (occupied)
    throw new Error(
      "Port 4107 is already occupied; no existing process was changed",
    );
  await mkdir(folder, { recursive: true });
  const owner = { nonce: randomUUID(), base };
  await save(ownerFile, owner);
  await save(eventsFile, []);
  const log = await open(join(folder, "notebook-server.log"), "a");
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "serve", folder],
    { detached: true, windowsHide: true, stdio: ["ignore", log.fd, log.fd] },
  );
  child.unref();
  await log.close();
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base + "/__owner", {
        headers: { "X-Fixture-Owner": owner.nonce },
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(200);
  }
  if (!ready)
    throw new Error(
      "Notebook fixture did not become ready; retain ownership for cleanup",
    );
  console.log(JSON.stringify({ ready: true, base, fixture_version: 1 }));
} else if (phase === "observe") {
  const events = await read(eventsFile);
  console.log(
    JSON.stringify({
      events,
      quote: events.at(-1)?.quote ?? null,
      source: "independent fixture POST event log",
    }),
  );
} else {
  let owner;
  try {
    owner = await read(ownerFile);
  } catch (e) {
    if (e.code === "ENOENT") {
      console.log(JSON.stringify({ already_stopped: true }));
      process.exit(0);
    }
    throw e;
  }
  let response;
  try {
    response = await fetch(base + "/__owner", {
      headers: { "X-Fixture-Owner": owner.nonce },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    console.log(JSON.stringify({ already_stopped: true }));
    process.exit(0);
  }
  if (!response.ok)
    throw new Error(
      "Fixture ownership mismatch; refusing to stop another process",
    );
  const stopped = await fetch(base + "/__stop", {
    method: "POST",
    headers: { "X-Fixture-Owner": owner.nonce },
  });
  if (!stopped.ok) throw new Error("Fixture cleanup failed");
  console.log(JSON.stringify({ stopped: true }));
}
