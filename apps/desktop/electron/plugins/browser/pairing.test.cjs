const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { installWindowsHost } = require("./windows-pairing.cjs");

const { EXTENSION_ID: extensionId } = require("./extension-id.cjs");
const hostName = "com.postorca.browser";
const hostScript = path.join(__dirname, "native-host.cjs");

test("unpacked extension public key matches the Web Store ID trusted by the native host", () => {
  const crypto = require("node:crypto");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../../browser-extension/manifest.json"), "utf8"));
  const digest = crypto.createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
  const id = digest.replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  assert.equal(id, extensionId);
});

function decode(buffer) {
  const length = buffer.readUInt32LE(0);
  assert.equal(buffer.length, 4 + length, "stdout must contain exactly one native message");
  return JSON.parse(buffer.subarray(4).toString("utf8"));
}

test("Windows registration points Edge and Chrome to an origin-restricted host", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "orca-host-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const calls = [];
  const { launcher, manifestFile } = installWindowsHost({
    userData: folder, executable: process.execPath, hostScript,
    pairingFile: path.join(folder, "pairing.json"), extensionId, hostName,
    register: (...args) => calls.push(args),
  });
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  assert.equal(manifest.path, launcher);
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${extensionId}/`]);
  assert.equal(calls.length, 2);
  for (const [exe, args] of calls) {
    assert.equal(exe, "reg.exe");
    assert.match(args[1], /^HKCU\\Software\\(?:Microsoft\\Edge|Google\\Chrome)\\NativeMessagingHosts\\com\.postorca\.browser$/);
    assert.equal(args[args.indexOf("/d") + 1], manifestFile);
  }
});

test("native host refuses other origins and reports a missing pairing file", () => {
  const invoke = (origin) => decode(spawnSync(process.execPath, [hostScript, origin], {
    env: { ...process.env, POSTORCA_EXTENSION_ID: extensionId, POSTORCA_PAIRING_FILE: path.join(os.tmpdir(), "orca-nonexistent-host", "pairing.json") },
  }).stdout);
  assert.deepEqual(invoke("chrome-extension://untrusted/"), { ok: false, code: "origin_forbidden" });
  assert.deepEqual(invoke(`chrome-extension://${extensionId}/`), { ok: false, code: "not_running" });
});

test("registration uses physical paths when the app sees a redirected data directory", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "orca-host-path-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const physical = path.join(folder, "physical");
  const apparent = path.join(folder, "apparent");
  fs.mkdirSync(physical);
  fs.symlinkSync(physical, apparent, process.platform === "win32" ? "junction" : "dir");
  const calls = [];
  const { launcher, manifestFile } = installWindowsHost({
    userData: apparent, executable: process.execPath, hostScript,
    pairingFile: path.join(apparent, "pairing.json"), extensionId, hostName,
    register: (...args) => calls.push(args),
  });
  const actual = fs.realpathSync.native(physical);
  assert.equal(path.dirname(launcher), actual);
  assert.equal(path.dirname(manifestFile), actual);
  assert.ok(fs.readFileSync(launcher, "utf8").includes(path.join(actual, "pairing.json")));
  assert.ok(calls.every(([, args]) => args[args.indexOf("/d") + 1] === manifestFile));
});

test("Windows launcher passes origin and binary reply without corrupting paths", { skip: process.platform !== "win32" }, (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "orca host ไทย & !-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const pairingFile = path.join(folder, "pair %POSTORCA_TEST_PATH% ! &.json");
  const expected = { port: 12345, secret: "test-secret" };
  fs.writeFileSync(pairingFile, JSON.stringify(expected));
  const { launcher } = installWindowsHost({
    userData: folder, executable: process.execPath, hostScript, pairingFile, extensionId, hostName,
    register: () => {},
  });
  const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${launcher}" chrome-extension://${extensionId}/ --parent-window=0"`], {
    windowsVerbatimArguments: true, windowsHide: true, timeout: 10_000,
    env: { ...process.env, POSTORCA_TEST_PATH: "must-not-expand" },
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(decode(result.stdout), { ok: true, ...expected });
});
