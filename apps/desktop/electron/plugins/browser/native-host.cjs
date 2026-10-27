// Native-messaging host for the PostOrca browser extension. The browser starts it (through
// the wrapper script pairing.cjs installs) when the extension asks how to reach the
// desktop app; it answers once with the relay's port and secret, read from the
// pairing file the running app writes. Runs under Electron as plain Node.
const fs = require("node:fs");

function reply(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
}

let pairing = null;
try {
  pairing = JSON.parse(fs.readFileSync(process.env.POSTORCA_PAIRING_FILE, "utf8"));
} catch {}
// Only the app's own extension may ask; the browser passes the caller's origin.
const origin = process.argv.find((arg) => arg.startsWith("chrome-extension://"));
if (origin !== `chrome-extension://${process.env.POSTORCA_EXTENSION_ID}/`)
  reply({ ok: false, code: "origin_forbidden" });
else if (!pairing) reply({ ok: false, code: "not_running" });
else reply({ ok: true, port: pairing.port, secret: pairing.secret });
