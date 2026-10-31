const fs = require("node:fs/promises");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app, nativeImage } = require("electron");
const { mediaBinary, allowed } = require("../../tools/files.cjs");
const render = require("./render.cjs");
const { snapRegion, textBox, closeUp, wholeWords, appTop } = require("./framing.cjs");
const { native } = require("../computer/native.cjs");

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
/**
 * The poster in gray, one byte per pixel, at full size so 1-pixel borders (a card's
 * edge) still count when finding the edges a focus snaps to.
 */
async function grayPixels(file, width, signal) {
  const { filename, directory } = mediaBinary("ffmpeg");
  const { stdout } = await run(
    filename,
    ["-v", "error", "-i", file, "-vf", "format=gray", "-f", "image2pipe", "-c:v", "rawvideo", "-"],
    { cwd: directory, signal, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  );
  return { gray: stdout, width, height: stdout.length / width };
}
/** The lines of text on a recording's frame at `ms`, from macOS text recognition. */
async function readText(file, ms, still, signal) {
  const { filename, directory } = mediaBinary("ffmpeg");
  await run(
    filename,
    ["-v", "error", "-ss", (ms / 1000).toFixed(3), "-i", file, "-frames:v", "1", "-y", still],
    { cwd: directory, signal },
  );
  const { lines = [], error } = await native({ action: "read_text", path: still }, signal);
  if (error) throw new Error(error);
  return lines;
}

/**
 * The text on screen in each previewed frame that falls on a recording, read from the
 * recording itself, with boxes as fractions of it (the space a focus uses), so a focus
 * can be aimed at a button or a total rather than guessed. A frame lists only what
 * changed since the last one read from the same clip. macOS only.
 */
async function screenText(props, directory, times, signal) {
  if (process.platform !== "darwin") return undefined;
  const seen = new Map();
  const frames = [];
  for (const time of times) {
    let start = 0,
      index = props.scenes.findIndex((scene) => {
        if (time < start + scene.durationMs) return true;
        start += scene.durationMs;
        return false;
      });
    const scene = props.scenes[index];
    if (!scene?.clip) continue;
    const { clip } = scene;
    const clipMs = Math.min(clip.endMs - 1, clip.startMs + (time - start) * clip.speed);
    const still = path.join(directory, `text-${frames.length}.png`);
    try {
      const lines = await readText(path.join(directory, scene.src), clipMs, still, signal);
      const round = (value) => Math.round(value * 100) / 100;
      const all = lines.map(
        (line) =>
          `${line.text} @ x ${round(line.x)} y ${round(line.y)} w ${round(line.width)} h ${round(line.height)}`,
      );
      const before = seen.get(scene.src);
      seen.set(scene.src, new Set(all));
      const shown = before ? all.filter((line) => !before.has(line)) : all;
      frames.push({
        at_seconds: time / 1000,
        scene: index + 1,
        clip_seconds: Math.round(clipMs / 100) / 10,
        ...(before && { only_changes: true }),
        text: shown.slice(0, 80),
      });
    } catch {
      // Reading text is a help for aiming a focus; the preview stands without it.
    }
  }
  return frames.length ? frames : undefined;
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
          if (scene.focus_on?.length) {
            if (process.platform !== "darwin")
              throw new Error(
                `Scene ${index + 1}: focus_on reads the text on screen, which needs macOS here; give a focus box instead.`,
              );
            // The text at a few moments through the scene, so something on screen only
            // part of the time (a result that appears, a title before it's renamed) can
            // be named too.
            const lines = [];
            const last = Math.max(startMs, endMs - 50);
            const moments = Math.min(4, Math.max(2, Math.ceil((last - startMs) / 1500) + 1));
            for (const ms of Array.from(
              { length: moments },
              (_, step) => startMs + ((last - startMs) * step) / (moments - 1),
            ))
              lines.push(
                ...(await readText(file, ms, path.join(temporary, `scene-${index}-text.png`), context.signal)),
              );
            const found = textBox(lines, scene.focus_on);
            if (found.missing)
              throw new Error(
                `Scene ${index + 1}: ${found.missing.map((name) => `"${name}"`).join(", ")} isn't on screen in that part of the clip. On screen: ${[...new Set(lines.map((line) => line.text))].slice(0, 60).join(" | ")}`,
              );
            const { gray, width, height } = await grayPixels(
              path.join(temporary, poster),
              info.width,
              context.signal,
            );
            const [w, h] = (args.format ?? "9:16").split(":").map(Number);
            const top = appTop(lines, gray, width, height);
            focus = closeUp(
              found.box,
              info.width / info.height,
              (w / h) * (args.format === "9:16" || !args.format ? 1 : 1.3),
              top,
              scene.zoom,
            );
            // Built from its text, it is about right: snapping tidies its edges, looking
            // further sideways (past a sliver of sidebar) than up and down (where the
            // browser's bars are).
            focus = snapRegion(gray, width, height, focus, { reachX: 0.1, reachY: 0.03 });
            focus = wholeWords(focus, lines);
            if (focus.y < top) focus = { ...focus, y: top, height: focus.height - (top - focus.y) };
          } else if (focus) {
            const { gray, width, height } = await grayPixels(
              path.join(temporary, poster),
              info.width,
              context.signal,
            );
            focus = snapRegion(gray, width, height, focus);
            // Snapping can move a drawn box's top edge up into the browser's bars; keep it
            // below them, as a close-up built from text is.
            if (process.platform === "darwin") {
              const lines = await readText(
                file,
                startMs,
                path.join(temporary, `scene-${index}-text.png`),
                context.signal,
              ).catch(() => []);
              const top = appTop(lines, gray, width, height);
              if (focus.y < top)
                focus = { ...focus, y: top, height: Math.max(0.05, focus.height - (top - focus.y)) };
            }
          }
        } else if (src)
          size = nativeImage
            .createFromPath(path.join(temporary, src))
            .getSize();
        scenes.push({
          src,
          clip,
          text: scene.text ?? null,
          subtitle: scene.subtitle ?? null,
          label: scene.label ?? null,
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
          const text = await screenText(
            options.props,
            options.assetsDir,
            args.times_ms,
            context.signal,
          );
          return {
            frames: args.times_ms.map((time) => time / 1000),
            ...(text && { screen_text: text }),
            attachments,
          };
        }),
    },
    video_clip_text: {
      // The text on a recording over time: what is on screen at the start, then what
      // appears and goes, and when. Read about once a second (at most 60 reads), so a
      // demo can cut to the moment a result appears and zoom on it. macOS only.
      run: async (args, context) => {
        if (process.platform !== "darwin")
          throw new Error("Reading a recording's text needs macOS here.");
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "postorca-clip-text-"));
        try {
          // A recording in the working folder is read in place; a saved one is fetched.
          let file;
          if (args.path) file = await allowed(args.path);
          else {
            const { data, type } = await context.download(args.file);
            file = path.join(temporary, "clip" + (extensions[type] ?? ".mp4"));
            await fs.writeFile(file, data);
          }
          const { seconds } = await probeClip(file, context.signal);
          const every = Math.max(args.every_ms ?? 1000, Math.ceil((seconds * 1000) / 60));
          const { filename, directory } = mediaBinary("ffmpeg");
          await run(
            filename,
            // The bundled ffmpeg has no fps filter; an output rate samples the same way.
            ["-v", "error", "-i", file, "-vf", "scale=1920:-2", "-r", String(1000 / every), path.join(temporary, "%03d.png")],
            { cwd: directory, signal: context.signal },
          );
          const stills = (await fs.readdir(temporary)).filter((name) => /^\d+\.png$/.test(name)).sort();
          const round = (value) => Math.round(value * 100) / 100;
          const describe = (line) =>
            `${line.text} @ x ${round(line.x)} y ${round(line.y)} w ${round(line.width)} h ${round(line.height)}`;
          // Text read twice the same way can differ by a space or a dot ("$0.00x" and
          // "$0.00 x"); compare loosely, and only report what holds for two reads, so a
          // cursor or a flicker isn't an event.
          const key = (text) => text.toLowerCase().replace(/[^a-z0-9$]/g, "");
          const reads = [];
          for (const still of stills) {
            const { lines = [], error } = await native(
              { action: "read_text", path: path.join(temporary, still) },
              context.signal,
            );
            if (error) throw new Error(error);
            reads.push(new Map(lines.filter((line) => key(line.text)).map((line) => [key(line.text), line])));
          }
          const start = [...(reads[0]?.values() ?? [])].map(describe);
          const changes = [];
          for (let index = 1; index < reads.length; index++) {
            const [before, now, next] = [reads[index - 1], reads[index], reads[index + 1] ?? reads[index]];
            const appeared = [...now.keys()].filter((text) => !before.has(text) && next.has(text));
            const gone = [...before.keys()].filter((text) => !now.has(text) && !next.has(text));
            if (appeared.length || gone.length)
              changes.push({
                at_seconds: Math.round((index * every) / 100) / 10,
                ...(appeared.length && { appeared: appeared.slice(0, 15).map((text) => describe(now.get(text))) }),
                ...(gone.length && { gone: gone.slice(0, 15).map((text) => before.get(text).text) }),
              });
          }
          return {
            seconds: Math.round(seconds * 10) / 10,
            every_seconds: every / 1000,
            on_screen_at_start: start.slice(0, 80),
            changes,
          };
        } finally {
          await fs.rm(temporary, { recursive: true, force: true });
        }
      },
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
