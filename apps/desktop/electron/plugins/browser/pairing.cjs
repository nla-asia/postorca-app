const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { installWindowsHost } = require("./windows-pairing.cjs");

/**
 * How the PostOrca browser extension finds the relay: a native-messaging host the browser
 * starts on the extension's request, which answers with the relay's port and secret.
 * Both change on every app start, so the pairing file only exists while the app runs.
 */

const { EXTENSION_ID } = require("./extension-id.cjs");
const HOST_NAME = "com.postorca.browser";
/** Each supported browser's profile root on macOS. */
const BROWSER_DIRS = [
  "Google/Chrome",
  "Microsoft Edge",
  "BraveSoftware/Brave-Browser",
];

const pairingFile = () => path.join(app.getPath("userData"), "browser-relay.json");

/**
 * The host script as a real file. Plain Node can't be relied on to read app.asar, so
 * the package keeps native-host.cjs unpacked next to it (asarUnpack).
 */
function nativeHostPath() {
  return path
    .join(__dirname, "native-host.cjs")
    .replace(/\.asar(?=[\\/])/, ".asar.unpacked");
}

/** Writes the pairing file and (re)installs the native-messaging host. */
function writePairing({ port, secret }) {
  fs.writeFileSync(pairingFile(), JSON.stringify({ port, secret }), {
    mode: 0o600,
  });
  if (process.platform === "win32") {
    installWindowsHost({
      userData: app.getPath("userData"),
      executable: process.execPath,
      hostScript: path.join(__dirname, "native-host.cjs"),
      pairingFile: pairingFile(),
      extensionId: EXTENSION_ID,
      hostName: HOST_NAME,
    });
    return;
  }
  if (process.platform !== "darwin") return;
  // Browsers start the host without arguments or environment, so a script carries them.
  const script = path.join(app.getPath("userData"), "browser-native-host.sh");
  const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(
    script,
    [
      "#!/bin/sh",
      `export ELECTRON_RUN_AS_NODE=1 POSTORCA_PAIRING_FILE=${quote(pairingFile())} POSTORCA_EXTENSION_ID=${EXTENSION_ID}`,
      `exec ${quote(process.execPath)} ${quote(nativeHostPath())} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  const manifest = JSON.stringify(
    {
      name: HOST_NAME,
      description: "PostOrca",
      path: script,
      type: "stdio",
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    },
    null,
    2,
  );
  const support = path.join(os.homedir(), "Library/Application Support");
  for (const dir of BROWSER_DIRS) {
    // Only browsers that are installed (have a profile root).
    if (!fs.existsSync(path.join(support, dir))) continue;
    const hosts = path.join(support, dir, "NativeMessagingHosts");
    fs.mkdirSync(hosts, { recursive: true });
    fs.writeFileSync(path.join(hosts, `${HOST_NAME}.json`), manifest);
  }
}

function removePairing() {
  fs.rmSync(pairingFile(), { force: true });
}

module.exports = { EXTENSION_ID, writePairing, removePairing };
