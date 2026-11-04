// node-pty 1.1.0's published Unix prebuild can lose its spawn-helper executable
// bit on npm extraction. Fix before use/packaging, never patch signed app files.
const fs = require("node:fs");
const path = require("node:path");

function prepareCommand(packageRoot) {
  if (process.platform === "win32") return;
  for (const relative of [
    `prebuilds/${process.platform}-${process.arch}/spawn-helper`,
    "build/Release/spawn-helper",
  ]) {
    const helper = path.join(packageRoot, relative);
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  }
}

if (require.main === module)
  prepareCommand(path.dirname(require.resolve("node-pty/package.json")));
module.exports = { prepareCommand };
