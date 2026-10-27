import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
