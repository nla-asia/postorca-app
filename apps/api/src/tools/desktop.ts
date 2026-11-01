import { z } from "zod";
import { callDesktop } from "../desktop/calls.js";
import { listProjects } from "../repositories/projects.js";
import { contentFolder } from "./content.js";
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
  /** File tools get the founder's project folders; besides the working folder, the only places they may read. */
  readsProjects?: boolean;
};

const projectPath = {
  type: "string",
  description:
    "A project folder (absolute path from the brand profile) or a folder inside one.",
};

/** What a capture tool captures: a display, one app window, or the iOS Simulator. */
const captureTarget = {
  type: "object",
  description:
    'What to capture: {"type": "screen"} (optionally "display"), {"type": "window", "window_id"} or {"type": "simulator"} (optionally "udid"), with ids from list_capture_targets.',
  properties: {
    type: { type: "string", enum: ["screen", "window", "simulator"] },
    display: {
      type: "integer",
      minimum: 1,
      description: "screen: display number. Omit for the main display.",
    },
    window_id: { type: "integer", description: "window: its window_id." },
    udid: {
      type: "string",
      description: "simulator: its udid. Omit for the booted one.",
    },
  },
  required: ["type"],
  additionalProperties: false,
};
const captureTargetArgs = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("screen"),
      display: z.number().int().min(1).max(16).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("window"), window_id: z.number().int().positive() })
    .strict(),
  z
    .object({
      type: z.literal("simulator"),
      udid: z.string().regex(/^[0-9A-F-]{36}$/i).optional(),
    })
    .strict(),
]);

const desktopTools: DesktopTool[] = [
  {
    definition: {
      name: "list_capture_targets",
      description:
        "List what screen_capture and screen_record_start can capture on the founder's Mac: displays, the app windows on screen (window_id, app, title, size) and booted iOS Simulators. Says when the app lacks the Screen Recording permission. Needs the desktop app on macOS.",
      parameters: object({}, []),
    },
    args: z.object({}).strict(),
    timeoutMs: 30_000,
  },
  {
    definition: {
      name: "screen_capture",
      description:
        "Take a screenshot on the founder's Mac of a display, one app window (without others on top of it) or the iOS Simulator's screen. Returns a PNG attachment ref and its size in pixels. Needs the desktop app on macOS and, except for the Simulator, its Screen Recording permission.",
      parameters: object({ target: captureTarget }, ["target"]),
    },
    args: z.object({ target: captureTargetArgs }).strict(),
    timeoutMs: 60_000,
  },
  {
    definition: {
      name: "screen_record_start",
      description:
        "Start recording video (no sound) of a display, one app window or the iOS Simulator's screen on the founder's Mac. Returns a recording id for screen_record_stop. One recording at a time; it can't pause, so record separate short clips. While it records, the founder sees it in the menu bar and can stop it there; it stops by itself after max_seconds (3 minutes). Needs the desktop app on macOS and, except for the Simulator, its Screen Recording permission.",
      parameters: object({ target: captureTarget }, ["target"]),
    },
    args: z.object({ target: captureTargetArgs }).strict(),
    timeoutMs: 30_000,
  },
  {
    definition: {
      name: "screen_record_stop",
      description:
        "Stop a recording from screen_record_start (or collect one that already stopped) and save it as an MP4 (H.264) to the founder's media. Returns its attachment ref, duration_seconds, size and stopped_by: tool, founder (from the menu bar), max_duration, or ended (its window closed).",
      parameters: object(
        { id: { type: "string", description: "The recording id." } },
        ["id"],
      ),
    },
    args: z.object({ id: z.string().min(1).max(100) }).strict(),
    timeoutMs: 360_000,
  },
  {
    definition: {
      name: "upload_file",
      description:
        "Upload an existing local file from the founder's working folder to authenticated server storage, preserving the complete original bytes. Supports images, audio, video and other files up to 200 MB. Runs on the connected desktop; path is absolute or relative to the working folder reported by desktop_status. Does not convert, trim, execute or publish the file. Returns a saved file ref/key, filename, detected type, size and checksum. Use create_artifact with kind image/audio/video and content set to the returned ref to deliver a reviewable task artifact. Files already returned by download_file, browser_fetch_file or media tools are uploaded already and do not need this tool.",
      parameters: object(
        {
          path: {
            type: "string",
            description: "Existing file inside the founder's working folder.",
          },
        },
        ["path"],
      ),
    },
    args: z.object({ path: z.string().min(1).max(1000) }).strict(),
    timeoutMs: 240_000,
  },
  {
    definition: {
      name: "download_file",
      description:
        "Download a public file when its HTTP(S) URL is known. Runs directly in Electron on the founder's computer and streams the original into Downloads/PostOrca/ without opening the browser or showing a Save dialog. Sends no browser cookies or login credentials. Supports images, audio, video, documents and other files up to 200 MB. filename is an optional suggested name; source_url optionally records the page where the URL was found. Returns the saved local path, original-file attachment, filename, byte count, detected file type, checksum and source URLs. Download only files relevant to the user's request. Does not execute downloaded files or assemble streaming video.",
      parameters: object(
        {
          url: { type: "string", description: "Public HTTP(S) file URL." },
          filename: { type: "string" },
          source_url: {
            type: "string",
            description: "Optional HTTP(S) source page URL.",
          },
        },
        ["url"],
      ),
    },
    args: z
      .object({
        url: z.url({ protocol: /^https?$/ }).max(8192),
        filename: z.string().min(1).max(120).optional(),
        source_url: z
          .url({ protocol: /^https?$/ })
          .max(8192)
          .optional(),
      })
      .strict(),
    timeoutMs: 240_000,
  },
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
        "List a folder on the founder's computer, inside their working folder (desktop_status shows where it is) or one of their project folders (brand profile projects): its files (with sizes) and subfolders. Needs the desktop app.",
      parameters: object(
        {
          path: {
            type: "string",
            description:
              "A folder inside the working folder or a project folder: absolute, or relative to the working folder (the first project folder without one). Omit for that folder itself.",
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
        "Read a file in the founder's working folder or one of their project folders. Text/code return text; PNG/JPEG return saved images. Audio (or a video's sound) returns a saved MP3 ref; audio longer than 300 seconds is an excerpt. Set start_seconds/duration_seconds to select an excerpt. Secrets are never read. Needs the desktop app.",
      parameters: object(
        {
          path: {
            type: "string",
            description:
              "The file: absolute, or relative to the working folder (the first project folder without one).",
          },
          start_seconds: {
            type: "number",
            minimum: 0,
            description: "Audio excerpt start; default 0.",
          },
          duration_seconds: {
            type: "number",
            minimum: 1,
            maximum: 300,
            description: "Audio excerpt length, at most 300 seconds.",
          },
        },
        ["path"],
      ),
    },
    args: z
      .object({
        path: z.string().min(1).max(1000),
        start_seconds: z.number().min(0).optional(),
        duration_seconds: z.number().min(1).max(300).optional(),
      })
      .strict(),
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
        "Files changed recently in one of the founder's project folders or their working folder, newest first, with when each changed and its size: finds work on things that aren't in git, such as designs, notes and recordings. Skips hidden, dependency and build folders. Needs the desktop app.",
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
 * opens paths inside those or its working folder.
 */
export const desktopToolset: Tool[] = desktopTools.map((tool) => ({
  definition: tool.definition,
  run: async (context: ToolContext, rawArgs: unknown) => {
    const args = tool.args.parse(rawArgs);
    const folder =
      tool.definition.name === "screen_record_stop" ? await contentFolder(context) : null;
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
        : { ...args, ...(folder && { content_folder: folder }) },
    );
  },
}));
