const { createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const MAX_BYTES = 200 * 1024 * 1024;
function assertFileResponse(type, filename) {
  if (
    /^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type || "") &&
    !/\.(html?|xhtml)$/i.test(filename || "")
  )
    throw new Error(
      "Received an HTML page instead of a file. The URL may require sign-in or point to a preview page. Use an explicit .html filename only when downloading HTML intentionally.",
    );
}
function httpUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("Use an HTTP(S) URL without embedded credentials.");
  return url.href;
}
function safeFilename(value) {
  let name = String(value || "download")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
    .slice(0, 120)
    .replace(/[. ]+$/g, "");
  if (!name || /^\.+$/.test(name)) name = "download";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = `_${name}`.slice(0, 120);
  return name;
}
function responseFilename(response, url) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {}
  }
  const plain = disposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
  if (plain) return (plain[1] ?? plain[2]).trim();
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").at(-1));
  } catch {
    return "download";
  }
}
async function saveOriginal(
  input,
  metadata,
  { signal, uploadFile },
  { directory, maxBytes = MAX_BYTES },
) {
  const name = safeFilename(metadata.filename);
  assertFileResponse(metadata.reported_type, name);
  const operationDirectory = path.join(
    path.resolve(directory),
    crypto.randomUUID(),
  );
  const target = path.join(operationDirectory, name);
  let downloaded = false;
  try {
    signal?.throwIfAborted();
    await fs.mkdir(operationDirectory, { recursive: true, mode: 0o700 });
    let bytes = 0;
    const hash = crypto.createHash("sha256");
    await pipeline(
      input,
      new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > maxBytes)
            return callback(new Error("Download exceeds the 200 MB limit."));
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    if (!bytes) throw new Error("Downloaded file is empty.");
    downloaded = true;
    const sha256 = hash.digest("hex");
    let imported;
    try {
      imported = await uploadFile(
        target,
        { ...metadata, filename: name },
        signal,
      );
    } catch (error) {
      throw new Error(
        `File saved at ${target}, but attachment import failed: ${error.message}. Do not download it again automatically.`,
        { cause: error },
      );
    }
    if (imported.sha256 !== sha256)
      throw new Error(
        `Attachment checksum mismatch. Original remains at ${target}.`,
      );
    return {
      ...imported,
      url: metadata.download_url,
      local_path: target,
      bytes,
      attachments: [
        {
          kind: "download",
          file: imported.file,
          mime_type: imported.mime_type,
          title: name,
          filename: name,
          bytes,
        },
      ],
    };
  } finally {
    if (!downloaded) {
      await fs.unlink(target).catch(() => {});
      await fs.rmdir(operationDirectory).catch(() => {});
    }
  }
}
module.exports = {
  assertFileResponse,
  MAX_BYTES,
  httpUrl,
  safeFilename,
  responseFilename,
  saveOriginal,
};
