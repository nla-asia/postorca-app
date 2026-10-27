import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError } from "./handlers/errors.js";
import { root } from "./storage.js";

/**
 * Orca's memory: Markdown files per founder under STORAGE_DIR/users/<user id>/memory/,
 * shared by every task. Orca saves what it wants to remember and finds it again with a
 * grep-style search. Paths are relative to the founder's memory folder, such as
 * founder.md or x/strategy-peers.md.
 *
 * Each file starts with a frontmatter description line. The list of paths and
 * descriptions is Orca's index, shown in its prompt at the start of every turn, so it
 * knows what it remembers without searching first.
 */
const MAX_FILE_CHARS = 20_000;
const MAX_MATCHES = 50;
const MAX_LINE_CHARS = 300;
const MAX_DESCRIPTION_CHARS = 200;
const pathPattern = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,2}\.md$/;
const frontmatterPattern = /^---\ndescription: *(.*)\n---\n/;
const FORMAT =
  'Start the file with a description line: "---\\ndescription: <one line saying what this file holds>\\n---\\n", then the Markdown.';

const description = (content: string) =>
  content.match(frontmatterPattern)?.[1].trim() ?? "";

const memoryDir = (userId: string) => join(root(), "users", userId, "memory");

function memoryFile(userId: string, path: string) {
  if (!pathPattern.test(path))
    throw new HttpError(
      400,
      "Use a lowercase path of words and hyphens ending in .md, at most three levels deep, such as founder.md or x/strategy-peers.md.",
    );
  return join(memoryDir(userId), path);
}

async function memoryFiles(userId: string) {
  const entries = await readdir(memoryDir(userId), { recursive: true }).catch(
    () => [] as string[],
  );
  return entries
    .map((entry) => entry.split(sep).join("/"))
    .filter((path) => pathPattern.test(path))
    .sort();
}

/** Every memory file with its description, size and last change. */
export async function listMemory(userId: string) {
  return Promise.all(
    (await memoryFiles(userId)).map(async (path) => {
      const file = join(memoryDir(userId), path);
      const [content, info] = await Promise.all([
        readFile(file, "utf8"),
        stat(file),
      ]);
      return {
        path,
        description: description(content),
        chars: content.length,
        updated_at: info.mtime.toISOString(),
      };
    }),
  );
}

/** Lines matching a case-insensitive regular expression, like grep -i across all files. */
export async function searchMemory(userId: string, pattern: string) {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    throw new HttpError(
      400,
      "The pattern is not a valid regular expression. Search for plain words, or join alternatives with |.",
    );
  }
  const matches: { path: string; line: number; text: string }[] = [];
  let total = 0;
  for (const path of await memoryFiles(userId)) {
    const lines = (
      await readFile(join(memoryDir(userId), path), "utf8")
    ).split("\n");
    for (const [index, text] of lines.entries()) {
      if (!regex.test(text)) continue;
      total++;
      if (matches.length < MAX_MATCHES)
        matches.push({
          path,
          line: index + 1,
          text: text.slice(0, MAX_LINE_CHARS),
        });
    }
  }
  return { matches, total };
}

/**
 * The index for the prompt: one line per file. Read once at the start of a turn, so
 * saves during the turn don't change the instructions and the prompt cache holds.
 */
export async function memoryIndex(userId: string) {
  return (await listMemory(userId))
    .map((file) => `- ${file.path}: ${file.description || "(no description)"}`)
    .join("\n");
}

export async function readMemory(userId: string, path: string) {
  const file = memoryFile(userId, path);
  try {
    const [content, info] = await Promise.all([
      readFile(file, "utf8"),
      stat(file),
    ]);
    return { path, content, updated_at: info.mtime.toISOString() };
  } catch {
    throw new HttpError(404, `No memory file ${path}.`);
  }
}

/** Creates or replaces a file. Writes a temporary file and renames it, so readers never see half a file. */
export async function writeMemory(
  userId: string,
  path: string,
  content: string,
) {
  const file = memoryFile(userId, path);
  if (content.length > MAX_FILE_CHARS)
    throw new HttpError(
      400,
      `A memory file must be at most ${MAX_FILE_CHARS} characters; split a long topic into several files. Nothing was saved.`,
    );
  const frontmatter = content.match(frontmatterPattern);
  const summary = frontmatter?.[1].trim();
  if (
    !summary ||
    summary.length > MAX_DESCRIPTION_CHARS ||
    !content.slice(frontmatter![0].length).trim()
  )
    throw new HttpError(
      400,
      `${FORMAT} The description is at most ${MAX_DESCRIPTION_CHARS} characters, and the file needs content after it. Nothing was saved.`,
    );
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, file);
  return { path, chars: content.length };
}

export async function deleteMemory(userId: string, path: string) {
  const file = memoryFile(userId, path);
  try {
    await stat(file);
  } catch {
    throw new HttpError(404, `No memory file ${path}.`);
  }
  await rm(file);
  // Remove folders the deletion left empty, up to the memory folder itself.
  for (
    let dir = dirname(file);
    relative(memoryDir(userId), dir);
    dir = dirname(dir)
  ) {
    if ((await readdir(dir)).length) break;
    await rm(dir, { recursive: true });
  }
  return { path, deleted: true };
}
