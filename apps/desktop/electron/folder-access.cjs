const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Resolve existing ancestors too, so a new destination cannot escape through a symlink.
function canonical(folder) {
  let current = path.resolve(folder.replace(/^~(?=$|[\\/])/, os.homedir()));
  const tail = [];
  for (;;) {
    try { return path.resolve(fs.realpathSync(current), ...tail); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      // realpath fails for dangling links; resolve those before walking the parent.
      try {
        if (fs.lstatSync(current).isSymbolicLink()) {
          current = path.resolve(path.dirname(current), fs.readlinkSync(current));
          continue;
        }
      } catch (linkError) { if (linkError.code !== "ENOENT") throw linkError; }
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.unshift(path.basename(current)); current = parent;
    }
  }
}
function contains(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function assertSeparated(working, sources = []) {
  if (!Array.isArray(sources) || sources.some((folder) => typeof folder !== "string" || !folder))
    throw new Error("Invalid read-only source folders.");
  const root = canonical(working);
  for (const source of sources) {
    const readOnly = canonical(source);
    if (contains(root, readOnly) || contains(readOnly, root))
      throw new Error("The working folder must be separate from read-only source folders. Choose a different working folder in Settings or a source folder outside it.");
  }
}
function assertWritable(target, working, sources = []) {
  assertSeparated(working, sources);
  if (!contains(canonical(working), canonical(target)))
    throw new Error("Generated content must stay inside the working folder; source folders are read-only.");
}
module.exports = { assertSeparated, assertWritable };
