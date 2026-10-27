const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// These are per-user registrations for this host only; administrator access is unnecessary.
const REGISTRY_ROOTS = [
  "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
  "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
];

function batchLiteral(value) {
  if (/["\r\n]/.test(value)) throw new Error("Invalid native-host path.");
  return value.replace(/%/g, "%%");
}

function installWindowsHost({ userData, executable, hostScript, pairingFile, extensionId, hostName, register = execFileSync }) {
  // MSIX-launched development processes can see a virtual AppData path that an
  // independently launched browser cannot read. Register the actual files.
  userData = fs.realpathSync.native(userData);
  pairingFile = path.join(fs.realpathSync.native(path.dirname(pairingFile)), path.basename(pairingFile));
  const launcher = path.join(userData, "browser-native-host.bat");
  const manifestFile = path.join(userData, `${hostName}.json`);
  fs.writeFileSync(launcher, [
    "@echo off",
    "chcp 65001 >nul",
    "setlocal EnableExtensions DisableDelayedExpansion",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `set "POSTORCA_PAIRING_FILE=${batchLiteral(pairingFile)}"`,
    `set "POSTORCA_EXTENSION_ID=${extensionId}"`,
    `"${batchLiteral(executable)}" "${batchLiteral(hostScript)}" %*`,
    "",
  ].join("\r\n"));
  fs.writeFileSync(manifestFile, JSON.stringify({
    name: hostName,
    description: "PostOrca",
    path: launcher,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }, null, 2));
  for (const root of REGISTRY_ROOTS) {
    register("reg.exe", ["ADD", `${root}\\${hostName}`, "/ve", "/t", "REG_SZ", "/d", manifestFile, "/f"], {
      windowsHide: true,
      stdio: "pipe",
      timeout: 10_000,
    });
  }
  return { launcher, manifestFile };
}

module.exports = { installWindowsHost };
