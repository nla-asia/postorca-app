const { Readable } = require("node:stream");
const {
  MAX_BYTES,
  httpUrl,
  responseFilename,
  saveOriginal,
} = require("../../tools/file-transfer.cjs");

// CDP commands cannot be cancelled individually. Stop waiting on abort, and close
// any resource stream returned after cancellation without reading or importing it.
function abortable(promise, signal, onLateValue = () => {}) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) void onLateValue(value);
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
async function fetchBrowserFile(
  page,
  session,
  { url, filename },
  context,
  { directory, maxBytes = MAX_BYTES, timeoutMs = 180_000 },
) {
  url = httpUrl(url);
  const signal = AbortSignal.any(
    [context.signal, AbortSignal.timeout(timeoutMs)].filter(Boolean),
  );
  signal.throwIfAborted();
  let handle;
  const close = (stream) =>
    session.send("IO.close", { handle: stream }).catch(() => {});
  try {
    const { frameTree } = await abortable(
      session.send("Page.getFrameTree"),
      signal,
    );
    const { resource } = await abortable(
      session.send("Network.loadNetworkResource", {
        frameId: frameTree.frame.id,
        url,
        options: { disableCache: true, includeCredentials: true },
      }),
      signal,
      (result) => result.resource?.stream && close(result.resource.stream),
    );
    handle = resource?.stream;
    if (
      resource?.httpStatusCode &&
      (resource.httpStatusCode < 200 || resource.httpStatusCode >= 300)
    )
      throw new Error(
        `Browser session fetch failed: HTTP ${resource.httpStatusCode}.`,
      );
    if (!resource?.success || !handle)
      throw new Error(
        `Browser session fetch failed: ${resource?.netErrorName || "no readable response stream"}.`,
      );
    const headers = new Headers(
      Object.fromEntries(
        Object.entries(resource.headers || {})
          .filter(([key]) =>
            ["content-type", "content-length", "content-disposition"].includes(
              key.toLowerCase(),
            ),
          )
          .map(([key, value]) => [key, String(value)]),
      ),
    );
    if (Number(headers.get("content-length")) > maxBytes)
      throw new Error("Download exceeds the 200 MB limit.");
    const name = filename || responseFilename({ headers }, url);
    async function* chunks() {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await abortable(
          session.send("IO.read", { handle, size: 64 * 1024 }),
          signal,
        );
        if (chunk.data)
          yield Buffer.from(
            chunk.data,
            chunk.base64Encoded ? "base64" : "utf8",
          );
        if (chunk.eof) return;
      }
    }
    // CDP reports response headers/status but no final redirect URL. Leave that
    // metadata absent rather than mislabel the requested URL as the final URL.
    return await saveOriginal(
      Readable.from(chunks()),
      {
        filename: name,
        source_url: page.url(),
        download_url: url,
        reported_type: headers.get("content-type")?.split(";")[0],
      },
      { ...context, signal },
      { directory, maxBytes },
    );
  } finally {
    if (handle) await close(handle);
  }
}
module.exports = { fetchBrowserFile };
