import { mkdtemp, mkdir, copyFile, readFile, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const staging = await mkdtemp(path.join(tmpdir(), "postorca-companion-package-"));
await mkdir(path.join(staging, "runtime"));
for (const file of ["cli.cjs", "README.md", "package.json"]) {
  await copyFile(path.join(root, "examples/browser-companion", file), path.join(staging, file));
}
for (const file of ["relay.cjs", "cdp-bridge.cjs", "windows-pairing.cjs", "native-host.cjs"]) {
  await copyFile(path.join(root, "apps/desktop/electron/plugins/browser", file), path.join(staging, "runtime", file));
}
const manifest = JSON.parse(await readFile(path.join(staging, "package.json"), "utf8"));
const extension = JSON.parse(await readFile(path.join(root, "apps/browser-extension/manifest.json"), "utf8"));
manifest.version = extension.version;
await writeFile(path.join(staging, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
if (!process.env.npm_execpath) throw new Error("Run through npm run browser:bridge:package or the website build.");
const destination = path.join(root, "apps/website/public/downloads");
await mkdir(destination, { recursive: true });
const result = JSON.parse(execFileSync(process.execPath,
  [process.env.npm_execpath, "pack", staging, "--ignore-scripts", "--json", "--pack-destination", destination],
  { cwd: root, encoding: "utf8", windowsHide: true }));
await rename(path.join(destination, result[0].filename), path.join(destination, "postorca-browser-companion.tgz"));
console.log("Packaged standalone companion at /downloads/postorca-browser-companion.tgz");
