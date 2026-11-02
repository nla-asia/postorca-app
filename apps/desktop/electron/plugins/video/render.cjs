const { randomBytes } = require("node:crypto");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const renderer = require("@remotion/renderer");

const entryPoint = path.resolve(__dirname, "../../../remotion/index.ts");
const mime = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

/** A render gets a private loopback URL serving only its direct media files. */
async function serveAssets(directory) {
  const prefix = `/${randomBytes(16).toString("hex")}/`;
  const server = http.createServer(async (request, response) => {
    let name;
    try {
      if (!request.url?.startsWith(prefix)) throw new Error("Unknown path");
      name = decodeURIComponent(request.url.slice(prefix.length).split("?")[0]);
    } catch {
      response.writeHead(404).end();
      return;
    }
    const type = mime[path.extname(name).toLowerCase()];
    if (
      !type ||
      name !== path.basename(name) ||
      name.startsWith(".") ||
      /[\\/]/.test(name)
    ) {
      response.writeHead(404).end();
      return;
    }
    const filename = path.join(directory, name);
    const stat = await fs.stat(filename).catch(() => null);
    if (!stat?.isFile()) {
      response.writeHead(404).end();
      return;
    }
    let start = 0,
      end = stat.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (range) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else if (range[2]) start = Math.max(0, stat.size - Number(range[2]));
      if (start > end) {
        response
          .writeHead(416, { "Content-Range": `bytes */${stat.size}` })
          .end();
        return;
      }
    }
    response.writeHead(range ? 206 : 200, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      ...(range && { "Content-Range": `bytes ${start}-${end}/${stat.size}` }),
    });
    if (request.method === "HEAD") response.end();
    else
      createReadStream(filename, { start, end })
        .on("error", () => response.destroy())
        .pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${prefix.slice(0, -1)}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

let bundle;
function bundleTemplates() {
  if (!bundle)
    bundle = require("@remotion/bundler")
      .bundle({ entryPoint })
      .catch((error) => {
        bundle = undefined;
        throw error;
      });
  return bundle;
}
async function prepareBrowser({ onProgress } = {}) {
  const browser = await renderer.ensureBrowser({
    onBrowserDownload: () => ({
      version: null,
      onProgress: ({ percent }) => onProgress?.(percent),
    }),
  });
  return browser.path;
}

async function withRender(options, run) {
  options.signal?.throwIfAborted();
  const assets = await serveAssets(options.assetsDir);
  const cancellation = renderer.makeCancelSignal();
  options.signal?.addEventListener("abort", cancellation.cancel, {
    once: true,
  });
  try {
    const inputProps = { ...options.props, assetBaseUrl: assets.url };
    const binaries = {
      browserExecutable: options.browserExecutable ?? null,
      binariesDirectory: options.binariesDirectory ?? null,
    };
    const composition = await renderer.selectComposition({
      ...binaries,
      serveUrl: options.serveUrl,
      id: options.template,
      inputProps,
      logLevel: "error",
    });
    options.signal?.throwIfAborted();
    return await run({
      ...binaries,
      serveUrl: options.serveUrl,
      inputProps,
      composition,
      cancelSignal: cancellation.cancelSignal,
      logLevel: "error",
    });
  } finally {
    options.signal?.removeEventListener("abort", cancellation.cancel);
    await assets.close();
  }
}
function renderVideo(options) {
  return withRender(options, async (settings) => {
    await renderer.renderMedia({
      ...settings,
      codec: "h264",
      outputLocation: options.outputPath,
      overwrite: true,
      onProgress: ({ progress }) => options.onProgress?.(progress),
    });
    const { width, height, fps, durationInFrames } = settings.composition;
    return {
      outputPath: options.outputPath,
      width,
      height,
      fps,
      durationInFrames,
    };
  });
}
function renderFrame(options) {
  return withRender(options, async (settings) => {
    const frame = Math.max(
      0,
      Math.min(
        settings.composition.durationInFrames - 1,
        Math.round((options.timeMs * settings.composition.fps) / 1000),
      ),
    );
    await renderer.renderStill({
      ...settings,
      frame,
      output: options.outputPath,
      imageFormat: "jpeg",
      jpegQuality: 85,
      scale: 0.5,
      overwrite: true,
    });
    return { outputPath: options.outputPath, frame };
  });
}
const captionsFromTranscript = (transcript) =>
  require("@remotion/elevenlabs").elevenLabsTranscriptToCaptions({ transcript })
    .captions;
module.exports = {
  entryPoint,
  serveAssets,
  bundleTemplates,
  prepareBrowser,
  renderVideo,
  renderFrame,
  captionsFromTranscript,
};
