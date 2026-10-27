const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { existsSync, mkdirSync, statSync } = require("node:fs");
const path = require("node:path");
const exec = promisify(execFile);

async function macBinary() {
  const { app } = require("electron");
  if (app.isPackaged)
    return path.join(process.resourcesPath, "computer-native");
  const source = path.join(__dirname, "native", "mac.swift");
  const output = path.join(
    __dirname,
    "../../../build/computer-use/computer-native",
  );
  if (
    !existsSync(output) ||
    statSync(output).mtimeMs < statSync(source).mtimeMs
  ) {
    mkdirSync(path.dirname(output), { recursive: true });
    await exec("xcrun", ["swiftc", source, "-o", output], { timeout: 120_000 });
  }
  return output;
}

async function native(request, signal) {
  let command, args;
  if (process.platform === "win32") {
    command = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    const script = path
      .join(__dirname, "native", "windows.ps1")
      .replace(/\.asar([\\/])/, ".asar.unpacked$1");
    args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
    ];
  } else if (process.platform === "darwin") {
    command = await macBinary();
    args = [];
  } else throw new Error("Computer Use supports Windows and macOS.");
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The native app/window helper timed out."));
    }, 15_000);
    child.stdout.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > 2_000_000) {
        child.kill();
        reject(new Error("Native observation exceeded its limit."));
      }
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + data.toString()).slice(-2000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(new Error(stderr || "The native helper failed."));
      try {
        const result = JSON.parse(stdout.replace(/^\uFEFF/, ""));
        if (result.error) reject(new Error(result.error));
        else resolve(result);
      } catch {
        reject(new Error("Invalid response from the native helper."));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
module.exports = { native, macBinary };
