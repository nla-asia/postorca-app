import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { createStorePackage } from "../package.mjs";

test("Web Store ZIP omits the development key and includes only runtime files at the root", async () => {
  const source = await readFile(new URL("../manifest.json", import.meta.url), "utf8");
  const { archive } = await createStorePackage();
  const files = unzipSync(archive);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.equal(Object.hasOwn(manifest, "key"), false);
  assert.ok(JSON.parse(source).key, "the unpacked extension must retain its store public key");
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, ...Object.values(manifest.icons)]) {
    assert.ok(files[file]?.length, `${file} must be packaged`);
  }
  assert.ok(Object.keys(files).every((file) => !/tests|node_modules|package\.json|package\.mjs|\.env/.test(file)));
  assert.equal(await readFile(new URL("../manifest.json", import.meta.url), "utf8"), source);
});
