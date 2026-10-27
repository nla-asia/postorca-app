// What the founder worked on, read-only, inside their project folders (see files.cjs
// for which folders are allowed). git_activity reads a repository's recent commits,
// uncommitted work and one commit's changes; recent_files lists recently changed
// files, for work that isn't in git. Git runs without a shell, with fixed arguments;
// files that may hold secrets are left out everywhere.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { allowed, isSecret } = require("./files.cjs");

const run = promisify(execFile);
const MAX_COMMITS = 100;
const MAX_FILES_PER_COMMIT = 40;
const MAX_UNCOMMITTED = 100;
const MAX_PATCH_CHARS = 40_000;
const MAX_RECENT = 200;
const MAX_VISITED = 50_000;
// Generated, dependency and lock files: noise in a story about the work.
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  "__pycache__",
  "venv",
  "Pods",
  "DerivedData",
]);
const EXCLUDE = [
  ":(exclude,glob)**/.env*",
  ":(exclude,glob)**/*.pem",
  ":(exclude,glob)**/*.key",
  ":(exclude,glob)**/*secret*",
  ":(exclude,glob)**/*credentials*",
  ":(exclude,glob)**/package-lock.json",
  ":(exclude,glob)**/yarn.lock",
  ":(exclude,glob)**/pnpm-lock.yaml",
  ":(exclude,glob)**/*.lock",
  ":(exclude,glob)**/node_modules/**",
  ":(exclude,glob)**/dist/**",
  ":(exclude,glob)**/build/**",
];

async function git(cwd, args) {
  try {
    const { stdout } = await run("git", ["-c", "core.quotepath=off", ...args], {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 20_000,
    });
    return stdout;
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("Git isn't installed on this computer.");
    throw new Error(
      String(error.stderr || error.message)
        .trim()
        .split("\n")[0],
    );
  }
}

const sinceDefault = () => new Date(Date.now() - 24 * 3600_000).toISOString();

async function commits(dir, since) {
  const out = await git(dir, [
    "log",
    `--since=${since}`,
    `--max-count=${MAX_COMMITS + 1}`,
    "--date=iso-strict",
    "--format=%x1e%H%x1f%ad%x1f%an%x1f%s%x1f%b%x1f",
    "--numstat",
    "--",
    ".",
  ]);
  const records = out.split("\x1e").filter((r) => r.trim());
  return {
    truncated: records.length > MAX_COMMITS,
    list: records.slice(0, MAX_COMMITS).map((record) => {
      const fields = record.split("\x1f");
      const [hash, date, author, subject, body] = fields;
      const files = (fields[5] ?? "")
        .split("\n")
        .map((line) => line.split("\t"))
        .filter((parts) => parts.length === 3 && !isSecret(parts[2]))
        .map(([added, removed, file]) => ({
          file,
          added: added === "-" ? null : Number(added),
          removed: removed === "-" ? null : Number(removed),
        }));
      return {
        hash: hash.trim().slice(0, 12),
        date,
        author,
        message: [subject, body?.trim()].filter(Boolean).join("\n\n"),
        lines_added: files.reduce((n, f) => n + (f.added ?? 0), 0),
        lines_removed: files.reduce((n, f) => n + (f.removed ?? 0), 0),
        files: files.slice(0, MAX_FILES_PER_COMMIT),
        ...(files.length > MAX_FILES_PER_COMMIT && {
          more_files: files.length - MAX_FILES_PER_COMMIT,
        }),
      };
    }),
  };
}

async function uncommitted(dir) {
  const lines = (await git(dir, ["status", "--porcelain=v1", "-uall", "--", "."]))
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), file: line.slice(3) }))
    .filter((change) => !isSecret(change.file));
  const stat = (await git(dir, ["diff", "--shortstat", "HEAD", "--", "."]).catch(() => "")).trim();
  return {
    files: lines.slice(0, MAX_UNCOMMITTED).map(({ status, file }) => ({
      file,
      change:
        status === "??" ? "new" : status.includes("D") ? "deleted" : status.includes("A") ? "added" : "modified",
    })),
    ...(lines.length > MAX_UNCOMMITTED && { more_files: lines.length - MAX_UNCOMMITTED }),
    ...(stat && { summary: stat }),
  };
}

async function oneCommit(dir, commit) {
  const out = await git(dir, [
    "show",
    "--date=iso-strict",
    "--format=%H%x1f%ad%x1f%an%x1f%B%x1f",
    "--stat=200",
    "--patch",
    "--no-color",
    commit,
    "--",
    ".",
    ...EXCLUDE,
  ]);
  const [hash, date, author, message, rest = ""] = out.split("\x1f");
  return {
    hash: hash.trim().slice(0, 12),
    date,
    author,
    message: message.trim(),
    changes: rest.slice(0, MAX_PATCH_CHARS).trim(),
    ...(rest.length > MAX_PATCH_CHARS && {
      truncated_chars: rest.length - MAX_PATCH_CHARS,
    }),
  };
}

const gitActivity = {
  run: async ({ path: requested, since, commit, roots }) => {
    const dir = await allowed(requested, roots);
    const top = (await git(dir, ["rev-parse", "--show-toplevel"]).catch(() => {
      throw new Error(`Not a git repository: ${dir}`);
    })).trim();
    if (commit) {
      if (!/^[0-9a-f]{4,40}$/i.test(commit)) throw new Error("Use a commit hash.");
      return { repository: top, folder: dir, commit: await oneCommit(dir, commit) };
    }
    const from = since ?? sinceDefault();
    const { list, truncated } = await commits(dir, from);
    const branch = (await git(dir, ["branch", "--show-current"]).catch(() => "")).trim();
    return {
      repository: top,
      folder: dir,
      ...(branch && { branch }),
      since: from,
      commits: list,
      ...(truncated && { more_commits: true }),
      uncommitted: await uncommitted(dir),
    };
  },
};

const recentFiles = {
  run: async ({ path: requested, hours, roots }) => {
    const dir = await allowed(requested, roots);
    const cutoff = Date.now() - (hours ?? 24) * 3600_000;
    const found = [];
    let visited = 0;
    const walk = async (folder) => {
      let entries;
      try {
        entries = await fs.readdir(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (++visited > MAX_VISITED) return;
        if (entry.name.startsWith(".") || isSecret(entry.name)) continue;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await walk(full);
        } else if (entry.isFile()) {
          const stat = await fs.stat(full).catch(() => null);
          if (stat && stat.mtimeMs >= cutoff)
            found.push({
              file: path.relative(dir, full),
              modified: new Date(stat.mtimeMs).toISOString(),
              bytes: stat.size,
            });
        }
      }
    };
    await walk(dir);
    found.sort((a, b) => b.modified.localeCompare(a.modified));
    return {
      folder: dir,
      hours: hours ?? 24,
      files: found.slice(0, MAX_RECENT),
      ...(found.length > MAX_RECENT && { more_files: found.length - MAX_RECENT }),
      ...(visited > MAX_VISITED && { stopped_early: "Folder too large; narrow the path." }),
    };
  },
};

module.exports = { git_activity: gitActivity, recent_files: recentFiles };
