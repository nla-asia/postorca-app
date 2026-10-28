import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const { HOST, DEFAULT_ID, install, uninstall, start, demo } = require("../../../examples/browser-companion/cli.cjs");

function folder(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "postorca-companion-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("example installs its own restricted host on Windows without touching PostOrca", (t) => {
  const directory = folder(t);
  const calls = [];
  const { manifestFile } = install({ directory, platform: "win32", register: (...args) => calls.push(args) });
  const manifest = JSON.parse(readFileSync(manifestFile));
  assert.equal(manifest.name, HOST);
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${DEFAULT_ID}/`]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([, args]) => args[1].endsWith(`\\${HOST}`)));
  assert.ok(readFileSync(manifest.path, "utf8").includes("native-host.cjs"));
  uninstall({ directory, platform: "win32", register: (_exe, args) => {
    calls.push(args);
    if (args[0] === "QUERY") return `    (Default)    REG_SZ    ${manifestFile}\r\n`;
  } });
  assert.equal(calls.filter((args) => args[0] === "DELETE").length, 2);
});

for (const platform of ["darwin", "linux"]) {
  test(`${platform}: example installs a framed-message host launcher and uninstalls only its registration`, (t) => {
    const directory = folder(t);
    const home = folder(t);
    const { launcher, manifestFile } = install({ directory, home, platform });
    const manifest = JSON.parse(readFileSync(manifestFile));
    assert.equal(manifest.path, launcher);
    assert.equal(manifest.name, HOST);
    assert.match(readFileSync(launcher, "utf8"), /POSTORCA_EXTENSION_ID=/);
    uninstall({ directory, home, platform });
    assert.equal(existsSync(manifestFile), false);
    assert.equal(existsSync(directory), true);
  });
}

test("standalone relay pairs through the native host and serves a local CDP demo without an API server", { timeout: 15000 }, async (t) => {
  const directory = folder(t);
  const companion = await start({ directory, pollMs: 10 });
  t.after(() => companion.stop());
  const invoke = (origin) => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../desktop/electron/plugins/browser/native-host.cjs", import.meta.url)), origin], {
      env: { ...process.env, POSTORCA_PAIRING_FILE: path.join(directory, "pairing.json"), POSTORCA_EXTENSION_ID: DEFAULT_ID },
    });
    assert.equal(result.status, 0, result.stderr.toString());
    const bytes = result.stdout;
    assert.equal(bytes.readUInt32LE(0), bytes.length - 4);
    return JSON.parse(bytes.subarray(4));
  };
  assert.equal(invoke("chrome-extension://untrusted/").ok, false);
  const pairing = invoke(`chrome-extension://${DEFAULT_ID}/`);
  assert.equal(pairing.port, companion.pairing.port);
  const ws = new WebSocket(`ws://127.0.0.1:${pairing.port}/extension`, { origin: `chrome-extension://${DEFAULT_ID}` });
  t.after(() => ws.terminate());
  const challengePromise = once(ws, "message");
  await once(ws, "open");
  const [challengeFrame] = await challengePromise;
  const challenge = JSON.parse(challengeFrame);
  const accepted = once(ws, "message");
  ws.send(JSON.stringify({ type: "proof", proof: crypto.createHmac("sha256", Buffer.from(pairing.secret, "hex")).update(challenge.nonce).digest("hex") }));
  assert.equal(JSON.parse((await accepted)[0]).type, "accepted");
  const commands = [];
  ws.on("message", (frame) => {
    const message = JSON.parse(frame);
    commands.push(message);
    if (message.type === "createTab") ws.send(JSON.stringify({ type: "result", seq: message.seq, result: { tabId: 7, targetId: "demo-tab", url: "about:blank", title: "" } }));
    if (message.type === "cdp") ws.send(JSON.stringify({ type: "result", seq: message.seq, result: { result: { value: "PostOrca bridge demo" } } }));
    if (message.type === "closeTab") ws.send(JSON.stringify({ type: "result", seq: message.seq, result: {} }));
    if (message.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
  });
  ws.send(JSON.stringify({ type: "hello", id: "local-test-profile", browser: "Chrome", userAgent: "test" }));
  for (let attempt = 0; attempt < 100; attempt++) {
    if (JSON.parse(readFileSync(companion.connectionFile)).browsers.length) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(await demo({ directory }), "PostOrca bridge demo");
  assert.deepEqual(commands.filter((c) => c.seq).map((c) => c.type), ["createTab", "cdp", "closeTab"]);
  assert.equal(commands[0].url, "about:blank");
  assert.match(commands.find((c) => c.type === "cdp").params.expression, /No API server or AI account/);
  await companion.stop();
  assert.equal(existsSync(path.join(directory, "pairing.json")), false);
  assert.equal(existsSync(companion.connectionFile), false);
});
