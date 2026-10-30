// Screen capture on the founder's Mac: screenshots and short recordings of the whole
// screen, one app window, or the iOS Simulator. Only an explicit tool call captures.
// While a recording runs, a menu bar item shows it with its time and stops it, and
// every recording stops itself after MAX_RECORD_SECONDS.
//
// macOS's screencapture does the screen and windows (a window by its id, even behind
// others, as H.264) and `xcrun simctl io` the Simulator (its screen, without the
// device frame). Both stop and save on SIGINT, so a clip ends when the agent (or the
// founder) says. The clip is remuxed to MP4 with the ffmpeg that ships with Remotion,
// so the video plugin can use it. (Electron's desktopCapturer with MediaRecorder would
// need a hidden renderer and a VP8/VP9 → H.264 transcode for the same clip.) Neither
// tool can pause, so a demo is recorded as short separate clips.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { promisify } = require("node:util");
const { mediaBinary } = require("./files.cjs");

const run = promisify(execFile);
const MAX_RECORD_SECONDS = 180;
// The server's upload limits.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

// Under plain Node (tests) require("electron") is a path, without the app.
function electron() {
  const value = require("electron");
  return typeof value === "string" ? null : value;
}

// The name System Settings lists the app under ("Electron" in development).
const appName = () => /([^/]+)\.app\//.exec(process.execPath)?.[1] ?? "PostOrca";
const permissionMessage = () =>
  `The desktop app doesn't have the Screen Recording permission, so it can't capture the screen or windows (the Simulator works without it). Ask the founder to turn on "${appName()}" in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen the app.`;

function screenAccess() {
  return electron()?.systemPreferences.getMediaAccessStatus("screen") ?? "granted";
}

/** Checks a target from the model: the screen, one window, or the Simulator. */
function parseTarget(target) {
  switch (target?.type) {
    case "screen": {
      const display = target.display ?? 1;
      if (!Number.isInteger(display) || display < 1 || display > 16)
        throw new Error("display must be a display number from list_capture_targets.");
      return { type: "screen", display };
    }
    case "window":
      if (!Number.isInteger(target.window_id) || target.window_id <= 0)
        throw new Error("window_id must be a window id from list_capture_targets.");
      return { type: "window", window_id: target.window_id };
    case "simulator": {
      const udid = target.udid ?? "booted";
      if (udid !== "booted" && !/^[0-9A-F-]{36}$/i.test(udid))
        throw new Error("udid must be a Simulator udid from list_capture_targets.");
      return { type: "simulator", udid };
    }
    default:
      throw new Error(
        'target must be {type: "screen"}, {type: "window", window_id} or {type: "simulator"}.',
      );
  }
}

const sourceArgs = (target) =>
  target.type === "window"
    ? ["-o", "-l", String(target.window_id)] // -o: without the window's shadow
    : ["-D", String(target.display)];
const screenshotCommand = (target, file) =>
  target.type === "simulator"
    ? ["xcrun", ["simctl", "io", target.udid, "screenshot", "--type=png", file]]
    : ["screencapture", ["-x", "-t", "png", ...sourceArgs(target), file]];
const recordCommand = (target, file) =>
  target.type === "simulator"
    ? ["xcrun", ["simctl", "io", target.udid, "recordVideo", "--codec=h264", "--force", file]]
    : ["screencapture", ["-x", "-v", ...sourceArgs(target), file]];

function captureError(target, output) {
  const detail = String(output ?? "").trim().split("\n").at(-1) ?? "";
  if (target.type === "window" && /could not create image from window/i.test(detail))
    return new Error(
      "That window can't be captured: it was closed, or is minimized or on another desktop. Call list_capture_targets for the current windows.",
    );
  if (target.type === "simulator" && /no devices are booted|invalid device/i.test(detail))
    return new Error(
      "No Simulator is running. Ask the founder to run their app in the iOS Simulator, or check list_capture_targets.",
    );
  return new Error(`Capture failed${detail ? `: ${detail.slice(0, 300)}` : "."}`);
}

function ffmpeg(args) {
  const { filename, directory } = mediaBinary("ffmpeg");
  return run(filename, ["-v", "error", ...args], { cwd: directory });
}

/** Duration, size and codec of a video, with Remotion's ffprobe. */
async function probe(file) {
  const { filename, directory } = mediaBinary("ffprobe");
  const { stdout } = await run(
    filename,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", file],
    { cwd: directory },
  );
  const info = JSON.parse(stdout);
  const stream = info.streams?.[0] ?? {};
  return {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    duration_seconds: Math.round(Number(info.format?.duration ?? 0) * 10) / 10,
  };
}

/**
 * Saves a recording as an MP4 (H.264): the recorded stream as is, or re-encoded
 * when it isn't H.264, is over the upload limit, or ends before `seconds` (how long
 * it recorded). The Simulator records only when its screen changes, so a clip
 * ending on a still screen is short: its last frame is held to the end.
 */
async function toMp4(input, output, { seconds = 0, maxBytes = MAX_VIDEO_BYTES } = {}) {
  const { codec, duration_seconds } = await probe(input);
  const hold = seconds - duration_seconds > 0.5 ? seconds - duration_seconds : 0;
  if (codec === "h264" && !hold) {
    await ffmpeg(["-i", input, "-map", "0:v:0", "-c", "copy", "-movflags", "+faststart", "-y", output]);
    if ((await fs.stat(output)).size <= maxBytes) return output;
  }
  const inputs = ["-i", input];
  let video = "[0:v]";
  if (hold) {
    const last = path.join(path.dirname(output), "last.png");
    await ffmpeg(["-sseof", "-1", "-i", input, "-update", "1", "-y", last]);
    inputs.push("-loop", "1", "-framerate", "30", "-t", hold.toFixed(2), "-i", last);
    video = "[0:v][1:v]concat=n=2:v=1,";
  }
  await ffmpeg([
    ...inputs,
    "-filter_complex", `${video}scale='min(1920,iw)':-2,format=yuv420p[v]`,
    "-map", "[v]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-fps_mode", "cfr", "-r", "30",
    "-movflags", "+faststart", "-y", output,
  ]);
  if ((await fs.stat(output)).size > maxBytes)
    throw new Error("The recording is too large to save (over 200 MB). Record shorter clips.");
  return output;
}

const pngSize = (data) => ({ width: data.readUInt32BE(16), height: data.readUInt32BE(20) });

// The windows on screen (all desktops' windows aren't capturable), from CoreGraphics.
const WINDOWS_SCRIPT = `ObjC.import("CoreGraphics");
JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0))))`;
/** App windows from CoreGraphics' window list, without menu bar items and overlays. */
function parseWindows(list) {
  return list
    .filter(
      (w) =>
        w.kCGWindowLayer === 0 &&
        w.kCGWindowAlpha > 0 &&
        w.kCGWindowBounds?.Width >= 80 &&
        w.kCGWindowBounds?.Height >= 80 &&
        !["Window Server", "Dock"].includes(w.kCGWindowOwnerName),
    )
    .map((w) => ({
      window_id: w.kCGWindowNumber,
      app: w.kCGWindowOwnerName,
      title: w.kCGWindowName ?? "",
      width: w.kCGWindowBounds.Width,
      height: w.kCGWindowBounds.Height,
    }));
}

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** A menu bar item while recording: shows the time and stops the recording. */
function menuBarIndicator() {
  let tray, ticker;
  return {
    show({ startedAt, stop }) {
      const { Tray, Menu, nativeImage } = electron();
      tray = new Tray(nativeImage.createEmpty());
      const title = () => `● REC ${clock(Date.now() - startedAt)}`;
      tray.setTitle(title());
      tray.setToolTip("Orca is recording your screen");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Orca is recording your screen", enabled: false },
          { label: "Stop recording", click: stop },
        ]),
      );
      ticker = setInterval(() => tray?.setTitle(title()), 1000);
    },
    hide() {
      clearInterval(ticker);
      tray?.destroy();
      tray = null;
    },
  };
}

/**
 * The capture tools. Dependencies are parameters so tests can run them without
 * macOS, Electron or a screen.
 */
let recordingNow = false;
/** Whether a screen recording is running, for tools that act differently on camera. */
const isRecording = () => recordingNow;

function createScreenTools({
  platform = process.platform,
  access = screenAccess,
  exec = run,
  spawnProcess = spawn,
  indicator = menuBarIndicator(),
  maxSeconds = MAX_RECORD_SECONDS,
  startupMs = 1000,
} = {}) {
  // Recordings by id, from start until screen_record_stop collects the clip.
  const recordings = new Map();
  let active = null;

  async function requireAccess(target) {
    if (platform !== "darwin") throw new Error("Screen capture works on macOS only.");
    if (target.type === "simulator") return;
    const status = access();
    if (status === "granted") return;
    // Asks macOS to show its permission prompt and list the app in System Settings.
    if (status === "not-determined")
      electron()?.desktopCapturer.getSources({ types: ["screen"] }).catch(() => {});
    throw new Error(permissionMessage());
  }

  /** Stops a recording and saves its MP4, once; later calls get the same result. */
  function finish(recording, stoppedBy) {
    recording.saved ??= (async () => {
      clearTimeout(recording.timer);
      recording.stopped_by = stoppedBy;
      recording.seconds = (Date.now() - recording.startedAt) / 1000;
      if (active === recording) {
        active = null;
        recordingNow = false;
        indicator.hide();
      }
      recording.child.kill("SIGINT");
      const kill = setTimeout(() => recording.child.kill("SIGKILL"), 15_000);
      await recording.exited;
      clearTimeout(kill);
      if (!(await fs.stat(recording.raw).catch(() => null)))
        throw captureError(recording.target, recording.stderr());
      return toMp4(recording.raw, path.join(recording.dir, "recording.mp4"), {
        seconds: recording.seconds,
      });
    })();
    recording.saved.catch(() => {}); // Reported by screen_record_stop.
    return recording.saved;
  }

  // A running recording ends with the app (screencapture would otherwise go on).
  const stopActive = () => active?.child.kill("SIGINT");
  process.on("exit", stopActive);
  electron()?.app.on("will-quit", stopActive);

  const listTargets = async () => {
    if (platform !== "darwin") throw new Error("Screen capture works on macOS only.");
    const status = access();
    // screencapture numbers displays from the main one.
    const screen = electron()?.screen;
    const primary = screen?.getPrimaryDisplay().id;
    const displays = (screen?.getAllDisplays() ?? [])
      .sort((a, b) => (b.id === primary) - (a.id === primary))
      .map((d, i) => ({ display: i + 1, label: d.label, width: d.size.width, height: d.size.height, main: d.id === primary }));
    const { stdout } = await exec("osascript", ["-l", "JavaScript", "-e", WINDOWS_SCRIPT], { timeout: 15_000 });
    const simulators = await exec("xcrun", ["simctl", "list", "devices", "booted", "-j"], { timeout: 15_000 })
      .then(({ stdout }) =>
        Object.values(JSON.parse(stdout).devices ?? {})
          .flat()
          .filter((d) => d.state === "Booted")
          .map((d) => ({ udid: d.udid, name: d.name })),
      )
      .catch(() => []); // No Xcode.
    return {
      displays,
      windows: parseWindows(JSON.parse(stdout)),
      simulators,
      ...(active && { recording: active.id }),
      // Without it, window titles are hidden and only the Simulator can be captured.
      ...(status !== "granted" && { permission: permissionMessage() }),
    };
  };

  const screenshot = async ({ target }, context) => {
    target = parseTarget(target);
    await requireAccess(target);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "postorca-capture-"));
    try {
      const file = path.join(dir, "capture.png");
      const [command, args] = screenshotCommand(target, file);
      await exec(command, args, { timeout: 30_000 }).catch((error) => {
        throw captureError(target, error.stderr || error.message);
      });
      let data = await fs.readFile(file);
      for (let size = 2560; data.length > MAX_IMAGE_BYTES && size >= 640; size = Math.round(size * 0.75)) {
        await exec("sips", ["-Z", String(size), file], { timeout: 30_000 });
        data = await fs.readFile(file);
      }
      const key = await context.upload(data, "image/png");
      return {
        target,
        ...pngSize(data),
        attachments: [{ file: key, mime_type: "image/png", title: "Screenshot" }],
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };

  const start = async ({ target }) => {
    target = parseTarget(target);
    if (active)
      throw new Error(`Recording ${active.id} is still running. Stop it with screen_record_stop first.`);
    await requireAccess(target);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "postorca-recording-"));
    const raw = path.join(dir, target.type === "simulator" ? "raw.mp4" : "raw.mov");
    const [command, args] = recordCommand(target, raw);
    const child = spawnProcess(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    const exited = new Promise((resolve) => {
      child.once("exit", resolve);
      child.once("error", (error) => {
        stderr += error.message;
        resolve();
      });
    });
    // A bad target (a closed window, no booted Simulator) ends it at once. The
    // Simulator says when it records; screencapture says nothing.
    const started = await Promise.race([
      exited.then(() => false),
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(true), target.type === "simulator" ? startupMs * 5 : startupMs);
        child.stderr?.on("data", () => {
          if (/recording started/i.test(stderr)) {
            clearTimeout(timer);
            resolve(true);
          }
        });
      }),
    ]);
    if (!started) {
      await fs.rm(dir, { recursive: true, force: true });
      throw captureError(target, stderr);
    }
    const recording = {
      id: `rec_${randomUUID().slice(0, 8)}`,
      target,
      dir,
      raw,
      child,
      exited,
      stderr: () => stderr,
      startedAt: Date.now(),
    };
    recording.timer = setTimeout(() => finish(recording, "max_duration"), maxSeconds * 1000);
    // Ended by itself (such as its window closing): no longer shown as recording.
    exited.then(() => recording.saved ?? finish(recording, "ended"));
    recordings.set(recording.id, recording);
    active = recording;
    recordingNow = true;
    indicator.show({ startedAt: recording.startedAt, stop: () => finish(recording, "founder") });
    return { id: recording.id, target, max_seconds: maxSeconds };
  };

  const stop = async ({ id }, context) => {
    const recording = typeof id === "string" && recordings.get(id);
    if (!recording)
      throw new Error("No recording with that id: it was already saved, or the desktop app restarted.");
    let file;
    try {
      file = await finish(recording, "tool");
    } catch (error) {
      recordings.delete(id);
      await fs.rm(recording.dir, { recursive: true, force: true });
      throw error;
    }
    const info = await probe(file);
    const data = await fs.readFile(file);
    // A failed upload keeps the clip, so stopping again retries it.
    const key = await context.upload(data, "video/mp4");
    recordings.delete(id);
    await fs.rm(recording.dir, { recursive: true, force: true });
    return {
      id,
      target: recording.target,
      duration_seconds: info.duration_seconds || Math.round(recording.seconds * 10) / 10,
      width: info.width,
      height: info.height,
      bytes: data.length,
      stopped_by: recording.stopped_by,
      attachments: [{ file: key, mime_type: "video/mp4", title: "Screen recording" }],
    };
  };

  return {
    list_capture_targets: { run: listTargets },
    screen_capture: { run: screenshot },
    screen_record_start: { run: start },
    screen_record_stop: { run: stop },
  };
}

let tools;
const lazy = (name) => ({
  run: (args, context) => (tools ??= createScreenTools())[name].run(args, context),
});
module.exports = {
  list_capture_targets: lazy("list_capture_targets"),
  screen_capture: lazy("screen_capture"),
  screen_record_start: lazy("screen_record_start"),
  screen_record_stop: lazy("screen_record_stop"),
  createScreenTools,
  isRecording,
  parseTarget,
  parseWindows,
  toMp4,
  probe,
  MAX_RECORD_SECONDS,
};
