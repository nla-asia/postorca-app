// File access on the founder's computer, inside their project folders (from the
// brand profile; the server sends them with each call as `roots`). A relative or
// missing path means the first project folder. Secrets (.env files, keys,
// credentials) are never read. list_dir lists a folder; read_file returns a text
// file's text, and saves a PNG or JPEG image to the server like a screenshot,
// returning its file key.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const TEXT = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".csv",
  ".json",
  ".html",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".sql",
  ".sh",
  ".css",
  ".scss",
  ".js",
  ".cjs",
  ".mjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".dart",
  ".c",
  ".h",
  ".cpp",
  ".cs",
  ".php",
  ".graphql",
  ".prisma",
]);
const TEXT_NAMES = new Set(["Dockerfile", "Makefile", "Procfile", "LICENSE"]);
/** Files that may hold secrets: never read, listed or shown in changes. */
function isSecret(file) {
  const name = path.basename(file);
  return (
    (/^\.env(\.|$)/.test(name) && !/\.(example|sample|template)$/.test(name)) ||
    /\.(pem|key|p12|pfx|keystore|jks|asc|gpg)$/i.test(name) ||
    /^id_(rsa|ed25519|ecdsa|dsa)/.test(name) ||
    /^\.(npmrc|netrc|pgpass|git-credentials)$/.test(name) ||
    /(^|[-_.])(secrets?|credentials)([-_.]|$)/i.test(name)
  );
}
const IMAGE = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const MAX_TEXT_BYTES = 200_000;
const MAX_ENTRIES = 500;

function sharedFolders(roots = []) {
  return (Array.isArray(roots) ? roots : [])
    .filter((root) => typeof root === "string" && root)
    .map((folder) => path.resolve(folder.replace(/^~(?=$|\/)/, os.homedir())));
}

// The real path, which must be inside a project folder (after resolving links).
async function allowed(requested, roots) {
  const folders = sharedFolders(roots);
  if (!folders.length)
    throw new Error(
      "No project folder is set. Ask the founder to add a project folder in their Brand Profile.",
    );
  const real = await fs
    .realpath(
      path.resolve(
        folders[0],
        (requested || ".").replace(/^~(?=$|\/)/, os.homedir()),
      ),
    )
    .catch(() => {
      throw new Error(`Not found: ${requested}`);
    });
  // Project folders may themselves be links; compare against their real paths.
  const realFolders = await Promise.all(
    folders.map((folder) => fs.realpath(folder).catch(() => folder)),
  );
  if (
    !realFolders.some(
      (folder) => real === folder || real.startsWith(folder + path.sep),
    )
  )
    throw new Error(
      `Not in a project folder (${folders.join(", ")}). Ask the founder to add its folder as a project in their Brand Profile.`,
    );
  if (isSecret(real))
    throw new Error("This file may hold secrets, so it can't be opened.");
  return real;
}

const listDir = {
  run: async ({ path: requested, roots }) => {
    const dir = await allowed(requested, roots);
    const entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => !entry.name.startsWith(".") && !isSecret(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const listed = [];
    for (const entry of entries.slice(0, MAX_ENTRIES)) {
      const full = path.join(dir, entry.name);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) continue;
      listed.push(
        stat.isDirectory()
          ? { name: entry.name, type: "folder" }
          : { name: entry.name, type: "file", bytes: stat.size },
      );
    }
    return {
      path: dir,
      entries: listed,
      ...(entries.length > MAX_ENTRIES && {
        truncated: entries.length - MAX_ENTRIES,
      }),
    };
  },
};

const readFile = {
  run: async ({ path: requested, roots }, context) => {
    const file = await allowed(requested, roots);
    const ext = path.extname(file).toLowerCase();
    const title = path.basename(file);
    if (TEXT.has(ext) || TEXT_NAMES.has(title)) {
      const data = await fs.readFile(file);
      return {
        path: file,
        text: data.subarray(0, MAX_TEXT_BYTES).toString("utf8"),
        ...(data.length > MAX_TEXT_BYTES && {
          truncated_bytes: data.length - MAX_TEXT_BYTES,
        }),
      };
    }
    if (IMAGE[ext]) {
      const key = await context.upload(await fs.readFile(file), IMAGE[ext]);
      return {
        path: file,
        attachments: [{ file: key, mime_type: IMAGE[ext], title }],
      };
    }
    throw new Error(
      `Can't read ${ext || "this"} files: text, code and PNG or JPEG images only.`,
    );
  },
};

module.exports = {
  list_dir: listDir,
  read_file: readFile,
  allowed,
  isSecret,
};
