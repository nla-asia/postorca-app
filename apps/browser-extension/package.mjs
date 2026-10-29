import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const root = fileURLToPath(new URL("./", import.meta.url));
const runtimeFiles = [
  "background.js", "capture.js", "connection.js", "popup.html", "popup.js",
  "options.html", "options.js", "icons/icon-16.png", "icons/icon-32.png",
  "icons/icon-48.png", "icons/icon-128.png",
];

export async function createStorePackage() {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  // Keep the Web Store public key in the unpacked source for a consistent ID,
  // but Chrome rejects key in uploaded ZIPs.
  delete manifest.key;
  const files = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2) + "\n") };
  for (const file of runtimeFiles) files[file] = new Uint8Array(await readFile(path.join(root, file)));
  return { manifest, archive: zipSync(files, { level: 9 }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { manifest, archive } = await createStorePackage();
  const output = path.resolve(process.argv[2] ?? path.join(root, "../../dist", `postorca-browser-bridge-${manifest.version}.zip`));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, archive);
  console.log(`Chrome Web Store ZIP: ${output}`);
}
