import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  open,
  rm,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * File storage for screenshots and generated media; binaries stay outside PostgreSQL.
 * Files live under STORAGE_DIR (default ./storage), addressed by keys of the form
 * users/<user id>/<folder>/<uuid>.<ext>. Messages store only the key. Local disk
 * for now; the key shape maps directly onto an object store later.
 */
export const root = () =>
  resolve(
    process.env.STORAGE_DIR ??
      fileURLToPath(new URL("../storage/", import.meta.url)),
  );
export const storedImageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;
export type StoredImageType = keyof typeof storedImageTypes;
export const storedFileTypes = {
  ...storedImageTypes,
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
  "application/octet-stream": "bin",
} as const;
export type StoredFileType = keyof typeof storedFileTypes;
const keyPattern =
  /^users\/[0-9a-f-]{36}\/[a-z]+\/[0-9a-f-]{36}\.(jpg|png|mp3|mp4|bin)$/;
export function fileMimeType(key: string): StoredFileType {
  if (!keyPattern.test(key)) throw new Error("Invalid file key.");
  const extension = key.slice(key.lastIndexOf(".") + 1);
  return (Object.keys(storedFileTypes) as StoredFileType[]).find(
    (type) => storedFileTypes[type] === extension,
  )!;
}

/** True when key is a well-formed file key owned by this user. */
export const isUserFileKey = (userId: string, key: string) =>
  keyPattern.test(key) && key.startsWith(`users/${userId}/`);

export async function saveFile(
  userId: string,
  folder: "screenshots" | "media",
  data: Buffer,
  type: StoredFileType,
) {
  const key = `users/${userId}/${folder}/${randomUUID()}.${storedFileTypes[type]}`;
  const path = join(root(), key);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, data, { mode: 0o600 });
  return key;
}

/**
 * A short reference for a file: the first 8 characters of its name. Tools show it
 * to the model, which copies it far more reliably than a full key, whose user id and
 * file id look alike and got spliced together.
 */
export const fileRef = (key: string) => key.split("/").at(-1)!.slice(0, 8);

/**
 * Resolves a full key or a short ref (fileRef) to one of the user's own file keys.
 * Null when nothing matches, or when a ref matches more than one file.
 */
export async function resolveUserFile(userId: string, ref: string) {
  if (isUserFileKey(userId, ref)) return ref;
  if (!/^[0-9a-f]{8}$/.test(ref)) return null;
  const matches: string[] = [];
  for (const folder of ["media", "screenshots", "downloads"]) {
    const names = await readdir(join(root(), "users", userId, folder)).catch(
      () => [] as string[],
    );
    for (const name of names) {
      const key = `users/${userId}/${folder}/${name}`;
      if (name.startsWith(ref) && keyPattern.test(key)) matches.push(key);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

/** Reads a file by key. The caller checks ownership with isUserFileKey first. */
export async function loadFile(key: string) {
  if (!keyPattern.test(key)) throw new Error("Invalid file key.");
  return readFile(join(root(), key));
}

export function filePath(key: string) {
  if (!keyPattern.test(key)) throw new Error("Invalid file key.");
  return join(root(), key);
}

export type DownloadMetadata = {
  filename: string;
  source_url?: string;
  download_url?: string;
  final_url?: string;
  reported_type?: string;
};
export const DOWNLOAD_LIMIT = 200 * 1024 * 1024;
// Detect previewable formats from bytes, never from a server's claimed MIME type.
export function detectDownloadType(data: Buffer) {
  if (data.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    return "image/jpeg";
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (
    data.toString("ascii", 0, 3) === "ID3" ||
    (data[0] === 255 && (data[1] & 0xe0) === 0xe0)
  )
    return "audio/mpeg";
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WAVE"
  )
    return "audio/wav";
  if (data.toString("ascii", 4, 8) === "ftyp")
    return /^M4[AB] /.test(data.toString("ascii", 8, 12))
      ? "audio/mp4"
      : "video/mp4";
  if (data.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return "application/octet-stream";
}
export async function saveDownload(
  userId: string,
  input: Readable,
  metadata: DownloadMetadata,
) {
  const key = `users/${userId}/downloads/${randomUUID()}.bin`;
  const target = filePath(key);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  let bytes = 0;
  const hash = createHash("sha256");
  try {
    await pipeline(
      input,
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > DOWNLOAD_LIMIT)
            return callback(new Error("Download exceeds 200 MB."));
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    if (!bytes) throw new Error("Downloaded file is empty.");
    const handle = await open(target, "r");
    const prefix = Buffer.alloc(512);
    let length: number;
    try {
      length = (await handle.read(prefix, 0, prefix.length, 0)).bytesRead;
    } finally {
      await handle.close();
    }
    const mime_type = detectDownloadType(prefix.subarray(0, length));
    const result = {
      ...metadata,
      mime_type,
      bytes,
      sha256: hash.digest("hex"),
    };
    await writeFile(`${target}.json`, JSON.stringify(result), { mode: 0o600 });
    return { file: key, ...result };
  } catch (error) {
    await rm(target, { force: true });
    await rm(`${target}.json`, { force: true });
    throw error;
  }
}
export async function describeFile(key: string) {
  if (!key.endsWith(".bin"))
    return { mime_type: fileMimeType(key), filename: key.split("/").at(-1)! };
  return JSON.parse(
    await readFile(`${filePath(key)}.json`, "utf8"),
  ) as DownloadMetadata & { mime_type: string; bytes: number };
}
