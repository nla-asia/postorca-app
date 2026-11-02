const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

test(
  "the macOS helper matches sheets and panels to their own window",
  { skip: process.platform !== "darwin", timeout: 180_000 },
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), "computer-native-"));
    try {
      const binary = path.join(dir, "tests"),
        source = path.join(dir, "main.swift");
      const helper = readFileSync(
        path.join(__dirname, "native", "mac.swift"),
        "utf8",
      );
      const entry = helper.indexOf("// Entry point.");
      assert.notEqual(entry, -1);
      writeFileSync(
        source,
        helper.slice(0, entry) +
          readFileSync(
            path.join(__dirname, "native", "mac-tests", "main.swift"),
            "utf8",
          ),
      );
      execFileSync("xcrun", ["swiftc", source, "-o", binary], {
        stdio: "pipe",
      });
      assert.doesNotThrow(() => execFileSync(binary, { encoding: "utf8" }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
