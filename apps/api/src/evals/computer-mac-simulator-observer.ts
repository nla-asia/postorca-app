/** Independent fixture/readback only. No actions are supplied to the agent. */
import { readdir, stat, copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { ComputerEvalCase } from "./computer-eval-types.js";
const require = createRequire(import.meta.url);
const desktop = () => join(homedir(), "Desktop");
const videos = async () =>
  (await readdir(desktop())).filter((name) =>
    /^Simulator Screen Recording .*\.(mov|mp4)$/i.test(name),
  );
const nativeHelper = fileURLToPath(
  new URL("../../../desktop/build/computer-use/computer-native", import.meta.url),
);
function nativeApps() {
  return JSON.parse(
    execFileSync(nativeHelper, {
      input: JSON.stringify({ action: "list", running_only: true }),
      encoding: "utf8",
      timeout: 15000,
    }),
  ).apps;
}
export async function prepareSimulator(
  entry: ComputerEvalCase,
  _folder: string,
) {
  if (entry.id !== "mac-simulator-maps") return;
  if (nativeApps().some((a: any) => a.name === "Simulator"))
    throw new Error(
      "Close Simulator before starting the cold-launch eval fixture.",
    );
  const devices = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "booted", "-j"], {
      encoding: "utf8",
      timeout: 15000,
    }),
  );
  const booted = Object.values(devices.devices).flat() as any[];
  if (booted.length)
    throw new Error(
      "Shut down the Simulator device before starting the cold-launch eval fixture.",
    );
  return { files: await videos(), startedAt: Date.now(), coldFixture: true };
}
export async function observeSimulator(
  entry: ComputerEvalCase,
  folder: string,
  baseline: any,
) {
  if (entry.id !== "mac-simulator-maps") return {};
  const { probe } = require("../../../desktop/electron/tools/screen.cjs");
  const { mediaBinary } = require("../../../desktop/electron/tools/files.cjs");
  const ffmpeg = mediaBinary("ffmpeg");
  const recordings = [];
  for (const name of await videos()) {
    if (baseline.files.includes(name)) continue;
    const source = join(desktop(), name),
      info = await stat(source);
    if (info.mtimeMs < baseline.startedAt || !info.isFile()) continue;
    await mkdir(join(folder, "recordings"), { recursive: true });
    const retained = join(folder, "recordings", name);
    await copyFile(source, retained);
    const metadata = await probe(retained);
    const frameFolder = join(folder, "recordings", "frames");
    await mkdir(frameFolder, { recursive: true });
    // The bundled FFmpeg supports seeking and scaling, but not the fps filter.
    for (
      let second = 0, frame = 1;
      second < metadata.duration_seconds && frame <= 120;
      second += 5, frame++
    ) {
      execFileSync(
        ffmpeg.filename,
        [
          "-v",
          "error",
          "-ss",
          String(second),
          "-i",
          retained,
          "-frames:v",
          "1",
          "-vf",
          "scale=400:-2",
          "-y",
          join(frameFolder, `${String(frame).padStart(3, "0")}.png`),
        ],
        { cwd: ffmpeg.directory, timeout: 15000 },
      );
    }
    recordings.push({
      source,
      retained,
      size: info.size,
      ...metadata,
      frames: frameFolder,
    });
  }
  return {
    coldFixture: baseline.coldFixture,
    simulatorRunning: nativeApps().some((a: any) => a.name === "Simulator"),
    recordings,
  };
}
