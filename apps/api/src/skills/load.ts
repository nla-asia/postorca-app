import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { HttpError } from "../handlers/errors.js";

/** Instructions for doing one kind of work, in a skill folder; Orca reads them with read_skill. */
export type SkillDefinition = {
  name: string;
  description: string;
  /** The skill's folder, relative to the API's source (or build) directory. */
  dir: string;
};

/**
 * A skill is a folder with a SKILL.md in the Agent Skills format (agentskills.io):
 * YAML frontmatter with its name (the folder's name) and description, then the
 * instructions in Markdown. Other files in the folder (references/, scripts/,
 * assets/) are read on demand with read_skill. Files are read from disk on each
 * call, so an edit to a skill applies on its next read.
 */
const apiRoot = fileURLToPath(new URL("../", import.meta.url));
// Text files the model can read from a skill's folder.
const READABLE = new Set([".md", ".txt", ".json", ".csv", ".yaml", ".yml"]);

function split(text: string, file: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) throw new Error(`${file} has no YAML frontmatter.`);
  return {
    meta: parse(match[1]) ?? {},
    body: text.slice(match[0].length).trimStart(),
  };
}

/** The skill in this folder; throws if its SKILL.md is missing or malformed. */
export function loadSkill(folder: URL): SkillDefinition {
  const dir = fileURLToPath(folder).replace(/[\\/]$/, "");
  const file = join(dir, "SKILL.md");
  const { meta } = split(readFileSync(file, "utf8"), file);
  if (meta.name !== basename(dir))
    throw new Error(`${file}: name must be the folder's name, ${basename(dir)}.`);
  if (typeof meta.description !== "string" || !meta.description.trim())
    throw new Error(`${file} needs a description.`);
  return {
    name: meta.name,
    description: meta.description.trim(),
    dir: relative(apiRoot, dir).split(sep).join("/"),
  };
}

function filesIn(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name.startsWith(".")
      ? []
      : entry.isDirectory()
        ? filesIn(join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
  );
}

/**
 * A file from a skill's folder: SKILL.md (without its frontmatter) by default, with
 * the folder's other files listed, or one of those files.
 */
export async function readSkillFile(
  skill: { name: string; dir: string },
  file = "SKILL.md",
) {
  const dir = resolve(apiRoot, skill.dir);
  const path = resolve(dir, file);
  if (!path.startsWith(dir + sep) || !READABLE.has(extname(path)))
    throw new HttpError(
      400,
      `Choose a text file inside the ${skill.name} skill, such as SKILL.md.`,
    );
  const others = filesIn(dir).filter((name) => name !== "SKILL.md");
  const text = await readFile(path, "utf8")
    .then((value) => value.replace(/\r\n/g, "\n"))
    .catch(() => {
      throw new HttpError(
        404,
        `The ${skill.name} skill has no ${file}.${others.length ? ` Its files: SKILL.md, ${others.join(", ")}.` : ""}`,
      );
    });
  if (path !== join(dir, "SKILL.md"))
    return { name: skill.name, file, content: text };
  return {
    name: skill.name,
    content: split(text, path).body,
    ...(others.length && { files: others }),
  };
}
