import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

/** Runtime sources, including the tools and skills offered dynamically to Orca. */
export async function computerRuntimeFiles(repoRoot: string, platform: string) {
  async function visit(directory: string): Promise<string[]> {
    const entries = await readdir(resolve(repoRoot, directory), { withFileTypes: true });
    const groups = await Promise.all(entries.map(async (entry) => {
      if (entry.name.startsWith(".") || /\.test\.[^.]+$/.test(entry.name)) return [];
      const file = `${directory}/${entry.name}`;
      if (file === "apps/api/src/evals" || file === "apps/api/src/scripts") return [];
      if (entry.isDirectory()) return visit(file);
      if (!entry.isFile()) return [];
      if (file.endsWith(".swift") && platform !== "darwin") return [];
      if (file.endsWith(".ps1") && platform !== "win32") return [];
      return [file];
    }));
    return groups.flat();
  }
  return [
    "package-lock.json",
    "apps/api/package.json",
    "apps/desktop/package.json",
    ...await visit("apps/api/src"),
    ...await visit("apps/desktop/electron"),
  ].sort();
}
