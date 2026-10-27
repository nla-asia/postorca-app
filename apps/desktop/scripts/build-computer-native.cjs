const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
if (process.platform !== "darwin")
  throw new Error(
    "Build the macOS computer helper on a Mac with Xcode Command Line Tools.",
  );
const output = path.join(__dirname, "../build/computer-use");
mkdirSync(output, { recursive: true });
execFileSync(
  "xcrun",
  [
    "swiftc",
    "-O",
    path.join(__dirname, "../electron/plugins/computer/native/mac.swift"),
    "-o",
    path.join(output, "computer-native"),
  ],
  { stdio: "inherit" },
);
