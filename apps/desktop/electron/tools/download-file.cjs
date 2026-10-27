const path = require("node:path");
const { Readable } = require("node:stream");
const {
  MAX_BYTES,
  httpUrl,
  safeFilename,
  responseFilename,
  saveOriginal,
} = require("./file-transfer.cjs");

// Node HTTP fetch stays separate from Electron/Edge cookie jars. The app owns
// the destination and limits; neither is supplied by model arguments.
async function downloadPublicFile(
  { url, filename, source_url },
  context,
  { directory, fetchImpl = fetch, maxBytes = MAX_BYTES, timeoutMs = 180_000 },
) {
  url = httpUrl(url);
  const source = source_url ? httpUrl(source_url) : url;
  const signal = AbortSignal.any(
    [context.signal, AbortSignal.timeout(timeoutMs)].filter(Boolean),
  );
  signal.throwIfAborted();
  let response,
    finalUrl = url;
  try {
    for (let redirects = 0; ; redirects++) {
      response = await fetchImpl(finalUrl, {
        redirect: "manual",
        credentials: "omit",
        signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Download redirect has no destination.");
      if (redirects >= 10) throw new Error("Too many download redirects.");
      finalUrl = httpUrl(new URL(location, finalUrl).href);
    }
    if (!response.ok) {
      if ([401, 403].includes(response.status))
        throw new Error(
          `Direct download returned HTTP ${response.status}. This URL may require browser sign-in or permission; browser-session access may be required.`,
        );
      throw new Error(`Direct download failed: HTTP ${response.status}.`);
    }
    if (!response.body) throw new Error("Download response has no file body.");
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new Error("Download exceeds the 200 MB limit.");
    return await saveOriginal(
      Readable.fromWeb(response.body),
      {
        filename: filename || responseFilename(response, finalUrl),
        source_url: source,
        download_url: url,
        final_url: finalUrl,
        reported_type: response.headers.get("content-type")?.split(";")[0],
      },
      { ...context, signal },
      { directory, maxBytes },
    );
  } finally {
    await response?.body?.cancel().catch(() => {});
  }
}
module.exports = {
  run: (args, context) =>
    downloadPublicFile(args, context, {
      directory: path.join(require("electron").app.getPath("downloads"), "PostOrca"),
    }),
  downloadPublicFile,
  safeFilename,
};
