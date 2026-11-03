import { api } from "./api";
import type { Brand } from "./brand";

/** The server remains the source of truth for registered read-only folders. */
export async function chooseWorkingFolder() {
  const profile = await api<Brand>("/brand-profile");
  const sources = profile.projects.flatMap((project) => project.folders ?? [project.path]);
  return window.postorca?.workingFolder.choose(sources) ?? null;
}
export function folderError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : fallback;
}
