const { app } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const run = require("node:util").promisify(execFile);
const assert = require("node:assert/strict");
const { makeFixtures } = require("./fixtures.cjs");

app
  .whenReady()
  .then(async () => {
    const directory = path.resolve(__dirname, "../../../.data/video-smoke");
    await makeFixtures(directory);
    const suffix = process.platform === "win32" ? "-msvc" : "";
    const binaries = path.dirname(
      require.resolve(
        `@remotion/compositor-${process.platform}-${process.arch}${suffix}/package.json`,
      ),
    );
    const binary = (name) =>
      path.join(binaries, name + (process.platform === "win32" ? ".exe" : ""));
    await run(
      binary("ffmpeg"),
      [
        "-v",
        "error",
        "-i",
        path.join(directory, "tone.wav"),
        "-c:a",
        "libmp3lame",
        "-y",
        path.join(directory, "tone.mp3"),
      ],
      { cwd: binaries },
    );
    const plugin = require("./index.cjs");
    const controller = new AbortController();
    let prefix = "",
      uploaded = 0;
    const context = {
      signal: controller.signal,
      download: async (key) => ({
        data: await fs.readFile(path.join(directory, key)),
        type: key.endsWith("png") ? "image/png" : "audio/mpeg",
      }),
      upload: async (data, type) => {
        const filename = `${prefix}-${++uploaded}.${type === "video/mp4" ? "mp4" : "jpg"}`;
        await fs.writeFile(path.join(directory, filename), data);
        return `users/00000000-0000-0000-0000-000000000000/media/${filename}`;
      },
    };
    const reports = [];
    for (const [format, width, height] of [
      ["9:16", 1080, 1920],
      ["4:5", 1080, 1350],
      ["1:1", 1080, 1080],
      ["16:9", 1920, 1080],
    ]) {
      prefix = format.replace(":", "x");
      uploaded = 0;
      const args = {
        format,
        title: `Local ${format} check`,
        brand: { background: "#112233", highlight: "#ffcc55" },
        scenes: [
          {
            file: "screen.png",
            text: "Local render check",
            duration_ms: 2000,
            fit: "contain",
            device: "browser",
          },
          {
            file: "screen.png",
            duration_ms: 2000,
            fit: "contain",
            device: "browser",
            focus: { x: 0.65, y: 0.58, width: 0.3, height: 0.25 },
            highlight: { x: 0.75, y: 0.65, width: 0.14, height: 0.1 },
          },
          { text: "Ready to review", duration_ms: 1000 },
        ],
        voiceover_file: "tone.mp3",
        music: {
          file: "tone.mp3",
          volume: 0.15,
          start_ms: 500,
          fade_in_ms: 500,
          fade_out_ms: 1000,
          voice_ranges_ms: [
            [200, 1500],
            [2200, 3800],
          ],
        },
        transcript: {
          language_code: "en",
          text: "Local render check",
          words: [
            { text: "Local", type: "word", start: 0.2, end: 1 },
            { text: " ", type: "spacing", start: 1, end: 1.1 },
            { text: "render", type: "word", start: 1.1, end: 2 },
            { text: " ", type: "spacing", start: 2, end: 2.1 },
            { text: "check", type: "word", start: 2.1, end: 3.8 },
          ],
        },
      };
      await plugin.tools.video_preview_frames.run(
        { ...args, times_ms: [500, 3000, 4500] },
        context,
      );
      const result = await plugin.tools.video_export.run(args, context);
      const filename = path.join(
        directory,
        path.basename(result.attachments[0].file),
      );
      const { stdout } = await run(
        binary("ffprobe"),
        [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          filename,
        ],
        { cwd: binaries },
      );
      const probe = JSON.parse(stdout);
      const video = probe.streams.find(
        (stream) => stream.codec_type === "video",
      );
      assert.equal(video.codec_name, "h264");
      assert.equal(video.width, width);
      assert.equal(video.height, height);
      assert.equal(video.r_frame_rate, "30/1");
      assert.ok(probe.streams.some((stream) => stream.codec_name === "aac"));
      assert.ok(Math.abs(Number(probe.format.duration) - 5) < 0.1);
      reports.push({
        format,
        width,
        height,
        duration: probe.format.duration,
        file: filename,
        render_seconds: result.render_seconds,
      });
      console.log(
        `Passed ${format}: H.264 ${width}×${height}, 30 fps, AAC, ${probe.format.duration} s`,
      );
    }
    await fs.writeFile(
      path.join(directory, "report.json"),
      JSON.stringify(reports, null, 2),
    );
    console.log(`Video smoke outputs: ${directory}`);
  })
  .then(
    () => app.quit(),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
