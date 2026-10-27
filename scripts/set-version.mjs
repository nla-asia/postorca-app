#!/usr/bin/env node
// Sets one version across the root, every workspace and the browser extension manifest.
// Usage: npm run version:set -- 0.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: npm run version:set -- X.Y.Z");
  process.exit(1);
}
const root = new URL("..", import.meta.url);
const files = [
  "package.json",
  "apps/api/package.json",
  "apps/browser-extension/package.json",
  "apps/browser-extension/manifest.json",
  "apps/connectors/package.json",
  "apps/desktop/package.json",
  "apps/website/package.json",
];
for (const file of files) {
  const url = new URL(file, root);
  const json = JSON.parse(readFileSync(url, "utf8"));
  json.version = version;
  writeFileSync(url, `${JSON.stringify(json, null, 2)}\n`);
}
// Keeps package-lock.json's workspace versions in step.
execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: root,
  stdio: "inherit",
});
console.log(`Set version ${version}.`);
