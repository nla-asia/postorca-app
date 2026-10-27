const fs = require("node:fs/promises");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app, nativeImage } = require("electron");
const render = require("./render.cjs");

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
};
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
        return filename;
      }
      const scenes = [];
      for (const [index, scene] of args.scenes.entries()) {
        const src = scene.file
          ? await download(scene.file, `scene-${index}`)
          : null;
        const size = src
          ? nativeImage.createFromPath(path.join(temporary, src)).getSize()
          : null;
        scenes.push({
          src,
          text: scene.text ?? null,
          durationMs: scene.duration_ms,
          fit: scene.fit ?? "cover",
          device: scene.device ?? null,
          focus: scene.focus ?? null,
          highlight: scene.highlight ?? null,
          aspect: size?.width && size.height ? size.width / size.height : null,
        });
      }
      const voiceover = args.voiceover_file
        ? await download(args.voiceover_file, "voiceover")
        : null;
      const music = args.music
        ? {
            src: await download(args.music.file, "music"),
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
