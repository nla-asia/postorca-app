import { z } from "zod";
import { callDesktop } from "../desktop/calls.js";
import { listProjects } from "../repositories/projects.js";
import { object, type Tool, type ToolContext } from "./shared.js";

/**
 * Tools that run on the founder's computer, in the desktop app's main process, over
 * the desktop connection (desktop/calls.ts). The server owns each schema and
 * validates arguments; the desktop implements the same names in electron/tools.
 */
type DesktopTool = {
  definition: Tool["definition"];
  args: z.ZodType<Record<string, unknown>>;
  timeoutMs: number;
  /** Server-side answer when no desktop is connected; otherwise the call fails. */
  offline?: () => unknown;
  /** File tools get the founder's project folders, the only places they may read. */
  readsProjects?: boolean;
};

const projectPath = {
  type: "string",
  description:
    "A project folder (absolute path from the brand profile) or a folder inside one.",
};

const desktopTools: DesktopTool[] = [
  {
    definition: {
      name: "desktop_status",
      description:
        "Check whether the founder's desktop app is running and connected, the status of its plugins (such as the browser), and which desktop tools it can run. Call this before relying on desktop tools.",
      parameters: object({}, []),
    },
    args: z.object({}).strict(),
    timeoutMs: 15_000,
    offline: () => ({
      available: false,
      reason: "The desktop app is not open or not signed in.",
    }),
  },
  {
    definition: {
      name: "list_dir",
      description:
        "List a folder inside one of the founder's project folders (brand profile projects) on their computer: its files (with sizes) and subfolders. Needs the desktop app.",
      parameters: object(
        {
          path: {
            type: "string",
            description:
              "A folder inside a project folder: absolute, or relative to the first project folder. Omit for the first project folder itself.",
          },
        },
        [],
      ),
    },
    args: z.object({ path: z.string().min(1).max(1000).optional() }).strict(),
    timeoutMs: 15_000,
    readsProjects: true,
  },
  {
    definition: {
      name: "read_file",
      description:
        "Read a file in one of the founder's project folders on their computer. Text and code files return their text; secrets (.env files, keys, credentials) are never read. PNG and JPEG images are saved to the founder's files and returned as an attachment you can see. Needs the desktop app.",
      parameters: object(
        {
          path: {
            type: "string",
            description:
              "The file: absolute, or relative to the first project folder.",
          },
        },
        ["path"],
      ),
    },
    args: z.object({ path: z.string().min(1).max(1000) }).strict(),
    timeoutMs: 120_000,
    readsProjects: true,
  },
  {
    definition: {
      name: "git_activity",
      description:
        "What the founder worked on in a git repository inside one of their project folders, read-only. Without commit: the commits since a time (newest first; hash, date, author, message, files changed, lines added and removed) and the work not committed yet (changed and new files). With commit: that one commit's message, files and changes, with secrets, lock files and generated folders left out and long changes cut. Needs the desktop app.",
      parameters: object(
        {
          path: projectPath,
          since: {
            type: "string",
            description:
              "ISO 8601 date-time, such as 2026-10-25T18:00:00Z. Omit for the last 24 hours.",
          },
          commit: {
            type: "string",
            description: "A commit hash from the list, to see its changes.",
          },
        },
        ["path"],
      ),
    },
    args: z
      .object({
        path: z.string().min(1).max(1000),
        since: z.iso.datetime({ offset: true }).optional(),
        commit: z
          .string()
          .regex(/^[0-9a-f]{4,40}$/i, "Use a commit hash.")
          .optional(),
      })
      .strict(),
    timeoutMs: 30_000,
    readsProjects: true,
  },
  {
    definition: {
      name: "recent_files",
      description:
        "Files changed recently in one of the founder's project folders, newest first, with when each changed and its size: finds work on things that aren't in git, such as designs, notes and recordings. Skips hidden, dependency and build folders. Needs the desktop app.",
      parameters: object(
        {
          path: projectPath,
          hours: {
            type: "number",
            minimum: 1,
            maximum: 720,
            description: "How far back to look. Default 24.",
          },
        },
        ["path"],
      ),
    },
    args: z
      .object({
        path: z.string().min(1).max(1000),
        hours: z.number().min(1).max(720).optional(),
      })
      .strict(),
    timeoutMs: 30_000,
    readsProjects: true,
  },
];

/**
 * The desktop tools as Orca's tools. File tools are sent the founder's project folders
 * as `roots` (added after validation, so the model can't set them); the desktop only
 * opens paths inside those.
 */
export const desktopToolset: Tool[] = desktopTools.map((tool) => ({
  definition: tool.definition,
  run: async (context: ToolContext, rawArgs: unknown) => {
    const args = tool.args.parse(rawArgs);
    return callDesktop(
      context,
      tool.definition.name,
      tool,
      tool.readsProjects
        ? {
            ...args,
            roots: (await listProjects(context.db, context.userId)).map(
              (project) => project.path,
            ),
          }
        : args,
    );
  },
}));
