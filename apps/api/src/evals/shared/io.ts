import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, writeFile, readdir } from "node:fs/promises";
import { resolve, relative, isAbsolute, join, dirname } from "node:path";
import type { Command } from "./contracts.js";

export const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const readJson = async (file: string) =>
  JSON.parse(await readFile(file, "utf8"));
export async function maybeJson(file: string): Promise<any | undefined> {
  try {
    return await readJson(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
export async function json(file: string, data: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, file);
}
export function contained(root: string, file: string) {
  const path = resolve(root, file);
  const rel = relative(root, path);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..\\`) ||
    rel.startsWith("../") ||
    isAbsolute(rel)
  )
    throw new Error("Evidence reference must name a file inside the attempt");
  return path;
}
export async function hook(command: Command, folder: string, output: string) {
  const { stdout, stderr } = await promisify(execFile)(
    command.executable,
    [...command.args, folder],
    {
      cwd: folder,
      timeout: command.timeout_ms,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      // Observer scripts have no need for the product session bearer token.
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key !== "POSTORCA_EVAL_TOKEN",
        ),
      ),
    },
  );
  if (stderr)
    await writeFile(join(folder, `${output}.stderr.log`), stderr, {
      mode: 0o600,
    });
  const data = JSON.parse(stdout);
  await json(join(folder, `${output}.json`), data);
  return data;
}
export async function checkReferences(folder: string, refs: string[]) {
  for (const ref of refs) {
    const [file, pointer] = ref.split("#", 2);
    const path = contained(folder, file);
    const content = await readFile(path);
    if (pointer) {
      let value: any = JSON.parse(content.toString());
      if (!pointer.startsWith("/"))
        throw new Error(`Invalid JSON pointer: ${ref}`);
      for (const key of pointer
        .slice(1)
        .split("/")
        .map((k) => k.replaceAll("~1", "/").replaceAll("~0", "~"))) {
        if (value == null || !Object.hasOwn(value, key))
          throw new Error(`Missing evidence: ${ref}`);
        value = value[key];
      }
    }
  }
}
/** Detect changes to every retained evidence file, including hook observations and media. */
export async function evidenceHash(folder: string): Promise<string> {
  const files: [string, string][] = [];
  async function walk(dir: string) {
    for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (e.isSymbolicLink())
        throw new Error("Evidence may not contain symbolic links");
      const path = join(dir, e.name);
      if (e.isDirectory()) await walk(path);
      else
        files.push([
          relative(folder, path).replaceAll("\\", "/"),
          sha(await readFile(path)),
        ]);
    }
  }
  await walk(join(folder, "evidence"));
  files.push([
    "evidence.json",
    sha(await readFile(join(folder, "evidence.json"))),
  ]);
  return sha(JSON.stringify(files));
}
