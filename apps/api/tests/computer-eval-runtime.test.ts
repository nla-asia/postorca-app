import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { computerRuntimeFiles } from "../src/scripts/computer-eval-runtime.js";
import { executionFingerprint } from "../src/evals/computer-gates.js";

test("runtime fingerprints track tool and skill changes and additions, keeping graders and private data separate", async () => {
  const folder = await mkdtemp(join(tmpdir(), "postorca-runtime-fingerprint-"));
  const save = async (file: string, text = "initial") => {
    await mkdir(dirname(join(folder, file)), { recursive: true });
    await writeFile(join(folder, file), text);
  };
  try {
    for (const file of [
      "package-lock.json", "apps/api/package.json", "apps/desktop/package.json",
      "apps/api/src/tools/artifacts.ts", "apps/api/src/skills/publish-post/SKILL.md",
      "apps/api/src/repositories/publications.ts", "apps/api/src/routes/publications.ts",
      "apps/api/src/migrations/011_publications.sql",
      "apps/desktop/electron/connection.cjs",
      "apps/desktop/electron/plugins/computer/native/windows.ps1",
      "apps/desktop/electron/plugins/computer/native/mac.swift",
      "apps/api/src/evals/computer-cases.ts", "apps/api/src/scripts/other-eval.ts",
      "apps/desktop/electron/plugins/computer/controller.test.cjs",
      "apps/api/src/.env", "apps/desktop/electron/.data/session.json",
    ]) await save(file);

    const files = await computerRuntimeFiles(folder, "win32");
    assert.ok(files.includes("apps/api/src/tools/artifacts.ts"));
    assert.ok(files.includes("apps/api/src/skills/publish-post/SKILL.md"));
    assert.ok(files.includes("apps/api/src/repositories/publications.ts"));
    assert.ok(files.includes("apps/api/src/routes/publications.ts"));
    assert.ok(files.includes("apps/api/src/migrations/011_publications.sql"));
    assert.ok(files.includes("apps/desktop/electron/plugins/computer/native/windows.ps1"));
    assert.ok(!files.some((file) => /evals\/|scripts\/|\.test\.|\.env|\.data|\.swift$/.test(file)));
    const mac = await computerRuntimeFiles(folder, "darwin");
    assert.ok(mac.some((file) => file.endsWith("mac.swift")));
    assert.ok(!mac.some((file) => file.endsWith("windows.ps1")));

    const fingerprint = async () => executionFingerprint(Object.fromEntries(
      await Promise.all((await computerRuntimeFiles(folder, "win32")).map(async (file) => [
        file, createHash("sha256").update(await readFile(join(folder, file))).digest("hex"),
      ])),
    ), "model", "win32");
    const first = await fingerprint();
    await save("apps/api/src/evals/computer-cases.ts", "grader change");
    assert.equal(await fingerprint(), first);
    await save("apps/api/src/tools/artifacts.ts", "different tool behavior");
    const toolChanged = await fingerprint();
    assert.notEqual(toolChanged, first);
    await save("apps/api/src/skills/publish-post/SKILL.md", "different instructions");
    const skillChanged = await fingerprint();
    assert.notEqual(skillChanged, toolChanged);
    await save("apps/api/src/tools/new-tool.ts", "new available tool");
    assert.notEqual(await fingerprint(), skillChanged);
  } finally {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith("postorca-runtime-fingerprint-"));
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
