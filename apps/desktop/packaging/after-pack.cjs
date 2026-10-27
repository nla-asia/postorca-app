// electron-builder afterPack hook (runs before signing).
//
// Remotion's compositor, ffmpeg and ffprobe load their dylibs by bare name and rely on
// DYLD_LIBRARY_PATH, which the hardened runtime ignores. Point every reference at
// @loader_path instead (the dylibs sit next to the binaries), so the app needs no
// DYLD entitlement.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack({ appOutDir, packager }) {
  if (packager.platform.name !== "mac") return;
  const remotion = path.join(
    appOutDir,
    `${packager.appInfo.productFilename}.app`,
    "Contents/Resources/app.asar.unpacked/node_modules/@remotion",
  );
  const dirs = fs
    .readdirSync(remotion)
    .filter((name) => name.startsWith("compositor-darwin-"))
    .map((name) => path.join(remotion, name));
  if (!dirs.length) throw new Error(`No Remotion compositor in ${remotion}`);
  for (const dir of dirs)
    for (const name of fs.readdirSync(dir)) {
      if (
        !["remotion", "ffmpeg", "ffprobe"].includes(name) &&
        !name.endsWith(".dylib")
      )
        continue;
      const file = path.join(dir, name);
      const bare = execFileSync("otool", ["-L", file], { encoding: "utf8" })
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(" (")[0])
        .filter((lib) => lib && !lib.includes("/"));
      if (!bare.length) continue;
      const args = bare.flatMap((lib) => [
        "-change",
        lib,
        `@loader_path/${lib}`,
      ]);
      if (name.endsWith(".dylib")) args.push("-id", `@loader_path/${name}`);
      execFileSync("install_name_tool", [...args, file], { stdio: "ignore" });
    }
};
