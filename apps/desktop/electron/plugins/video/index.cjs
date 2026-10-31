const fs = require("node:fs/promises");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app, nativeImage } = require("electron");
const { mediaBinary } = require("../../tools/files.cjs");
const render = require("./render.cjs");
const { snapRegion } = require("./framing.cjs");

const run = promisify(execFile);

const defaults = {
  background: "#151715",
  text: "#ffffff",
  highlight: "#f2a541",
};
const extensions = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

/** Size and length of a clip, with Remotion's ffprobe. */
async function probeClip(file, signal) {
  const { filename, directory } = mediaBinary("ffprobe");
  const { stdout } = await run(
    filename,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      file,
    ],
    { cwd: directory, signal },
  );
  const info = JSON.parse(stdout);
  return {
    width: info.streams?.[0]?.width,
    height: info.streams?.[0]?.height,
    seconds: Number(info.format?.duration) || 0,
  };
}
/** A still of the clip at `seconds`, for the blurred background behind it. */
async function clipPoster(file, seconds, output, signal) {
  const { filename, directory } = mediaBinary("ffmpeg");
  await run(
    filename,
    [
      "-v",
      "error",
      "-ss",
      seconds.toFixed(3),
      "-i",
      file,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      "-y",
      output,
    ],
    { cwd: directory, signal },
  );
}
/** The poster in gray, one byte per pixel, for finding the edges a focus snaps to. */
async function grayPixels(file, signal) {
  const { filename, directory } = mediaBinary("ffmpeg");
  const width = 960;
  const { stdout } = await run(
    filename,
    ["-v", "error", "-i", file, "-vf", `scale=${width}:-2,format=gray`, "-f", "rawvideo", "-"],
    { cwd: directory, signal, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  return { gray: stdout, width, height: stdout.length / width };
}
if (app.isPackaged) {
  const workingDirectory = path.join(app.getPath("userData"), "video");
  mkdirSync(workingDirectory, { recursive: true });
  writeFileSync(path.join(workingDirectory, "package.json"), "{}\n");
  process.chdir(workingDirectory);
}
let browser;
function prepareBrowser() {
  if (!browser)
    browser = render.prepareBrowser().catch((error) => {
      browser = undefined;
      throw error;
    });
  return browser;
}
function binariesDirectory() {
  if (!app.isPackaged) return null;
  const suffix = process.platform === "win32" ? "-msvc" : "";
  return path
    .dirname(
      require.resolve(
        `@remotion/compositor-${process.platform}-${process.arch}${suffix}/package.json`,
      ),
    )
    .replace(/\.asar(?=[\\/])/, ".asar.unpacked");
}

let queue = Promise.resolve();
function withAssets(args, context, run) {
  const job = queue.then(async () => {
    context.signal?.throwIfAborted();
    const temporary = await fs.mkdtemp(
      path.join(os.tmpdir(), "postorca-video-"),
    );
    try {
      const [serveUrl, browserExecutable] = await Promise.all([
        app.isPackaged
          ? path.join(process.resourcesPath, "remotion-bundle")
          : render.bundleTemplates(),
        prepareBrowser(),
      ]);
      context.signal?.throwIfAborted();
      async function download(key, name) {
        const { data, type } = await context.download(key);
        if (!extensions[type])
          throw new Error(`Unsupported file type ${type}.`);
        const filename = name + extensions[type];
        await fs.writeFile(path.join(temporary, filename), data);
        return { filename, video: type.startsWith("video/") };
      }
      const scenes = [];
      for (const [index, scene] of args.scenes.entries()) {
        const media = scene.file
          ? await download(scene.file, `scene-${index}`)
          : null;
        const src = media?.filename ?? null;
        let size = null,
          clip = null,
          focus = scene.focus ?? null;
        if (media?.video) {
          const file = path.join(temporary, src);
          const info = await probeClip(file, context.signal);
          const length = Math.round(info.seconds * 100) / 100;
          const startMs = scene.start_ms ?? 0;
          const endMs = scene.end_ms ?? Math.round(info.seconds * 1000);
          if (
            startMs >= info.seconds * 1000 - 100 ||
            endMs > info.seconds * 1000 + 50
          )
            throw new Error(
              `Scene ${index + 1} trims ${startMs / 1000}–${endMs / 1000} s, past the end of its clip, which is ${length} s long. Keep start_seconds and end_seconds within 0–${length}.`,
            );
          const poster = `scene-${index}-poster.jpg`;
          await clipPoster(
            file,
            startMs / 1000,
            path.join(temporary, poster),
            context.signal,
          );
          size = info;
          clip = { startMs, endMs, speed: scene.speed ?? 1, poster };
          if (focus) {
            const { gray, width, height } = await grayPixels(
              path.join(temporary, poster),
              context.signal,
            );
            focus = snapRegion(gray, width, height, focus);
          }
        } else if (src)
          size = nativeImage
            .createFromPath(path.join(temporary, src))
            .getSize();
        scenes.push({
          src,
          clip,
          text: scene.text ?? null,
          durationMs: scene.duration_ms,
          fit: scene.fit ?? "cover",
          device: scene.device ?? null,
          focus,
          highlight: scene.highlight ?? null,
          aspect: size?.width && size.height ? size.width / size.height : null,
        });
      }
      const voiceover = args.voiceover_file
        ? (await download(args.voiceover_file, "voiceover")).filename
        : null;
      const music = args.music
        ? {
            src: (await download(args.music.file, "music")).filename,
            volume: args.music.volume,
            startMs: args.music.start_ms ?? 0,
            fadeInMs: args.music.fade_in_ms ?? 500,
            fadeOutMs: args.music.fade_out_ms ?? 1000,
            voiceRangesMs: args.music.voice_ranges_ms ?? null,
          }
        : null;
      const props = {
        scenes,
        format: args.format ?? "9:16",
        voiceover,
        music,
        captions: args.transcript
          ? render.captionsFromTranscript(args.transcript)
          : [],
        brand: { ...defaults, ...args.brand },
      };
      const output = path.join(temporary, "out");
      await fs.mkdir(output);
      return await run(
        {
          serveUrl,
          browserExecutable,
          binariesDirectory: binariesDirectory(),
          assetsDir: temporary,
          template: "VerticalClip",
          props,
          signal: context.signal,
        },
        output,
      );
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
  queue = job.catch(() => {});
  return job;
}

module.exports = {
  name: "video",
  start: prepareBrowser,
  status: async () => ({ available: true }),
  tools: {
    video_preview_frames: {
      run: (args, context) =>
        withAssets(args, context, async (options, output) => {
          const attachments = [];
          for (const time of args.times_ms) {
            const filename = path.join(output, `${attachments.length}.jpg`);
            await render.renderFrame({
              ...options,
              outputPath: filename,
              timeMs: time,
            });
            const file = await context.upload(
              await fs.readFile(filename),
              "image/jpeg",
            );
            attachments.push({
              kind: "preview",
              file,
              mime_type: "image/jpeg",
              title: `Preview at ${(time / 1000).toFixed(1)} s`,
            });
          }
          return {
            frames: args.times_ms.map((time) => time / 1000),
            attachments,
          };
        }),
    },
    video_export: {
      run: (args, context) =>
        withAssets(args, context, async (options, output) => {
          const started = Date.now();
          const filename = path.join(output, "video.mp4");
          const result = await render.renderVideo({
            ...options,
            outputPath: filename,
          });
          const data = await fs.readFile(filename);
          const file = await context.upload(data, "video/mp4");
          return {
            width: result.width,
            height: result.height,
            fps: result.fps,
            megabytes: Math.round(data.length / 1e5) / 10,
            render_seconds: Math.round((Date.now() - started) / 1000),
            ref: file.split("/").at(-1).slice(0, 8),
            attachments: [{ file, mime_type: "video/mp4", title: args.title }],
          };
        }),
    },
  },
};
