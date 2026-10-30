const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  createScreenTools,
  parseTarget,
  parseWindows,
  toMp4,
  probe,
} = require("./screen.cjs");
const { mediaBinary } = require("./files.cjs");
const { screenPng } = require("../plugins/video/fixtures.cjs");

let dir, h264Mov, pngMov;
function ffmpeg(...args) {
  const { filename, directory } = mediaBinary("ffmpeg");
  execFileSync(filename, ["-v", "error", ...args], { cwd: directory });
}
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "postorca-screen-test-"));
  const still = path.join(dir, "screen.png");
  fs.writeFileSync(still, screenPng());
  // What screencapture records (H.264 in a .mov), and a .mov in another codec.
  h264Mov = path.join(dir, "h264.mov");
  ffmpeg(
    "-loop",
    "1",
    "-framerate",
    "10",
    "-t",
    "2",
    "-i",
    still,
    "-vf",
    "scale=64:-2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    h264Mov,
  );
  pngMov = path.join(dir, "png.mov");
  ffmpeg(
    "-loop",
    "1",
    "-framerate",
    "10",
    "-t",
    "1",
    "-i",
    still,
    "-vf",
    "scale=64:-2",
    "-c:v",
    "png",
    pngMov,
  );
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// A recorder process that saves the clip when stopped with SIGINT, like screencapture
// and simctl; with failWith, it exits at once with that error instead.
function fakeSpawn({ failWith } = {}) {
  const calls = [];
  const spawnProcess = (command, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.signals = [];
    let exited = false;
    const exit = (code) => {
      if (exited) return;
      exited = true;
      setImmediate(() => child.emit("exit", code));
    };
    child.kill = (signal) => {
      child.signals.push(signal);
      if (signal === "SIGINT" && !exited) fs.copyFileSync(h264Mov, args.at(-1));
      exit(0);
    };
    calls.push({ command, args, child });
    if (failWith)
      setImmediate(() => {
        child.stderr.emit("data", failWith);
        exit(1);
      });
    return child;
  };
  return { calls, spawnProcess };
}
function fakeIndicator() {
  return {
    shown: 0,
    hidden: 0,
    show(options) {
      this.shown++;
      this.stop = options.stop;
    },
    hide() {
      this.hidden++;
    },
  };
}
const uploads = [];
const context = {
  upload: async (data, type) => {
    uploads.push({ bytes: data.length, type });
    return `media/${uploads.length}.${type.split("/")[1]}`;
  },
};

test("targets are checked before anything captures", () => {
  assert.deepEqual(parseTarget({ type: "screen" }), {
    type: "screen",
    display: 1,
  });
  assert.deepEqual(parseTarget({ type: "window", window_id: 42 }), {
    type: "window",
    window_id: 42,
  });
  assert.deepEqual(parseTarget({ type: "simulator" }), {
    type: "simulator",
    udid: "booted",
  });
  assert.throws(() => parseTarget(undefined), /target must be/);
  assert.throws(() => parseTarget({ type: "camera" }), /target must be/);
  assert.throws(
    () => parseTarget({ type: "window", window_id: "42; rm -rf ~" }),
    /window_id/,
  );
  assert.throws(() => parseTarget({ type: "screen", display: 0 }), /display/);
  assert.throws(
    () => parseTarget({ type: "simulator", udid: "--help" }),
    /udid/,
  );
});

test("without the Screen Recording permission, says how to grant it", async () => {
  const { calls, spawnProcess } = fakeSpawn();
  const tools = createScreenTools({
    platform: "darwin",
    access: () => "denied",
    spawnProcess,
    indicator: fakeIndicator(),
    startupMs: 20,
  });
  const message =
    /System Settings → Privacy & Security → Screen & System Audio Recording/;
  await assert.rejects(
    tools.screen_record_start.run({ target: { type: "screen" } }),
    message,
  );
  await assert.rejects(
    tools.screen_capture.run(
      { target: { type: "window", window_id: 7 } },
      context,
    ),
    message,
  );
  assert.equal(calls.length, 0);
  // The Simulator records its own screen and needs no permission.
  const { id } = await tools.screen_record_start.run({
    target: { type: "simulator" },
  });
  assert.deepEqual(calls[0].args.slice(0, 4), [
    "simctl",
    "io",
    "booted",
    "recordVideo",
  ]);
  await tools.screen_record_stop.run({ id }, context);

  const linux = createScreenTools({
    platform: "linux",
    spawnProcess,
    indicator: fakeIndicator(),
  });
  await assert.rejects(
    linux.screen_record_start.run({ target: { type: "screen" } }),
    /macOS only/,
  );
});

test("a recording shows in the menu bar and stops itself at the max duration", async () => {
  const { calls, spawnProcess } = fakeSpawn();
  const indicator = fakeIndicator();
  const tools = createScreenTools({
    raiseWindow: async () => ({ foreground: true }),
    platform: "darwin",
    access: () => "granted",
    spawnProcess,
    indicator,
    maxSeconds: 0.2,
    startupMs: 20,
  });
  const started = await tools.screen_record_start.run({
    target: { type: "window", window_id: 42 },
  });
  assert.match(started.id, /^rec_/);
  assert.equal(started.max_seconds, 0.2);
  assert.deepEqual(calls[0], {
    command: "screencapture",
    args: ["-x", "-v", "-o", "-l", "42", calls[0].args.at(-1)],
    child: calls[0].child,
  });
  assert.equal(indicator.shown, 1);
  await assert.rejects(
    tools.screen_record_start.run({ target: { type: "screen" } }),
    /still running/,
  );

  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(calls[0].child.signals, ["SIGINT"]);
  assert.equal(indicator.hidden, 1);
  const stopped = await tools.screen_record_stop.run(
    { id: started.id },
    context,
  );
  assert.equal(stopped.stopped_by, "max_duration");
  assert.equal(stopped.duration_seconds, 2);
  assert.equal(stopped.width, 64);
  assert.deepEqual(uploads.at(-1), { bytes: stopped.bytes, type: "video/mp4" });
  assert.equal(stopped.attachments[0].mime_type, "video/mp4");
  await assert.rejects(
    tools.screen_record_stop.run({ id: started.id }, context),
    /No recording with that id/,
  );
});

test("the founder can stop a recording from the menu bar", async () => {
  const { spawnProcess } = fakeSpawn();
  const indicator = fakeIndicator();
  const tools = createScreenTools({
    platform: "darwin",
    access: () => "granted",
    spawnProcess,
    indicator,
    startupMs: 20,
  });
  const { id } = await tools.screen_record_start.run({
    target: { type: "screen" },
  });
  await indicator.stop();
  assert.equal(indicator.hidden, 1);
  // A new recording can start; the stopped one is still there to collect.
  const next = await tools.screen_record_start.run({
    target: { type: "screen", display: 2 },
  });
  assert.equal(
    (await tools.screen_record_stop.run({ id }, context)).stopped_by,
    "founder",
  );
  assert.equal(
    (await tools.screen_record_stop.run({ id: next.id }, context)).stopped_by,
    "tool",
  );
});

test("a window that can't be recorded fails the start with a clear message", async () => {
  const { spawnProcess } = fakeSpawn({
    failWith: "could not create image from window\n",
  });
  const indicator = fakeIndicator();
  const tools = createScreenTools({
    raiseWindow: async () => ({ foreground: true }),
    platform: "darwin",
    access: () => "granted",
    spawnProcess,
    indicator,
    startupMs: 200,
  });
  await assert.rejects(
    tools.screen_record_start.run({ target: { type: "window", window_id: 9 } }),
    /closed, or is minimized/,
  );
  assert.equal(indicator.shown, 0);
});

test("recordings become H.264 MP4s with the bundled ffmpeg", async () => {
  const copied = await toMp4(h264Mov, path.join(dir, "copied.mp4"));
  assert.deepEqual(await probe(copied), {
    codec: "h264",
    width: 64,
    height: 40,
    duration_seconds: 2,
  });
  // Not H.264: re-encoded.
  const encoded = await toMp4(pngMov, path.join(dir, "encoded.mp4"));
  assert.equal((await probe(encoded)).codec, "h264");
  assert.equal(path.extname(encoded), ".mp4");
  // Ended before the recording stopped (a still Simulator screen): its last frame is held.
  const held = await probe(
    await toMp4(h264Mov, path.join(dir, "held.mp4"), { seconds: 4 }),
  );
  assert.equal(held.codec, "h264");
  assert.ok(
    Math.abs(held.duration_seconds - 4) <= 0.1,
    `${held.duration_seconds} s`,
  );
  await assert.rejects(
    toMp4(h264Mov, path.join(dir, "big.mp4"), { maxBytes: 10 }),
    /too large/,
  );
});

test("window list keeps app windows only", () => {
  const window = (over) => ({
    kCGWindowLayer: 0,
    kCGWindowAlpha: 1,
    kCGWindowNumber: 1,
    kCGWindowOwnerName: "Safari",
    kCGWindowName: "Docs",
    kCGWindowBounds: { X: 0, Y: 0, Width: 800, Height: 600 },
    ...over,
  });
  assert.deepEqual(
    parseWindows([
      window({}),
      window({ kCGWindowLayer: 25, kCGWindowOwnerName: "Control Center" }),
      window({ kCGWindowOwnerName: "Window Server" }),
      window({ kCGWindowBounds: { Width: 30, Height: 20 } }),
      window({ kCGWindowNumber: 2, kCGWindowName: undefined }),
    ]),
    [
      { window_id: 1, app: "Safari", title: "Docs", width: 800, height: 600 },
      { window_id: 2, app: "Safari", title: "", width: 800, height: 600 },
    ],
  );
});

test("recording a window brings it to the front first, and refuses if it can't", async () => {
  const order = [];
  const { spawnProcess } = fakeSpawn();
  const spawned = (...args) => {
    order.push("record");
    return spawnProcess(...args);
  };
  const tools = (raiseWindow) =>
    createScreenTools({
      platform: "darwin",
      access: () => "granted",
      spawnProcess: spawned,
      indicator: fakeIndicator(),
      startupMs: 1,
      raiseWindow,
    });
  const front = tools(async (id) => {
    order.push(`raise ${id}`);
    return { foreground: true };
  });
  const target = { type: "window", window_id: 42 };
  const started = await front.screen_record_start.run({ target });
  assert.deepEqual(order, ["raise 42", "record"]);
  await front.screen_record_stop.run({ id: started.id }, context);

  order.length = 0;
  const covered = tools(async () => ({ foreground: false }));
  await assert.rejects(
    covered.screen_record_start.run({ target }),
    /could not be brought to the front, so nothing was recorded/,
  );
  const failing = tools(async () => {
    throw new Error("cannot be told apart");
  });
  await assert.rejects(
    failing.screen_record_start.run({ target }),
    /could not be brought to the front/,
  );
  assert.deepEqual(order, []);

  // The Simulator and whole screens are not windows to raise.
  order.length = 0;
  const other = tools(async () => order.push("raise"));
  const screen = await other.screen_record_start.run({
    target: { type: "screen" },
  });
  assert.deepEqual(order, ["record"]);
  await other.screen_record_stop.run({ id: screen.id }, context);
});
