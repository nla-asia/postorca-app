import { messageMedia, type MediaAttachment } from "./media";
import type { TaskMessage } from "./tasks";

/** One tool call as the founder sees it: a readable step and its state. */
export type WorkAction = {
  label: string;
  failed?: boolean;
  /** Called but not finished yet. */
  pending?: boolean;
  /** Failure message, shown on hover. */
  detail?: string;
  /** Files the tool attached, such as screenshots taken while working. */
  media?: MediaAttachment[];
};

const shortUrl = (value: unknown) => {
  try {
    const url = new URL(String(value));
    return (url.host.replace(/^www\./, "") + url.pathname).replace(/\/$/, "");
  } catch {
    return String(value ?? "a page");
  }
};
/** The last part of a file or folder path. */
const folder = (value: unknown) =>
  String(value ?? "").split(/[\\\/]/).filter(Boolean).at(-1) ?? "";
const clip = (value: unknown, length = 40) => {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
};

const captureTarget = (target: { type?: string } | undefined) =>
  target?.type === "window"
    ? "a window"
    : target?.type === "simulator"
      ? "the Simulator"
      : "the screen";

function describe(
  name: string,
  args: Record<string, any>,
  result: Record<string, any> | undefined,
) {
  switch (name) {
    case "media_generate_image":
      return `Created image “${clip(args.title, 60)}”`;
    case "media_edit_image":
      return `Edited image “${clip(args.title, 60)}”`;
    case "media_list_voices":
      return "Searched available voices";
    case "media_generate_speech":
      return `Created speech “${clip(args.title, 60)}”`;
    case "media_generate_music":
      return `Created music “${clip(args.title, 60)}”`;
    case "media_generate_sound_effect":
      return `Created sound effect “${clip(args.title, 60)}”`;
    case "media_transcribe":
      return "Transcribed audio";
    case "read_brand_profile":
      return "Read your brand profile";
    case "update_brand_profile":
      return `Updated your brand profile (${Object.keys(args).join(", ") || "no fields"})`;
    case "save_brand_link":
      return `Saved link “${clip(args.name)}”`;
    case "delete_brand_link":
      return "Removed a link";
    case "create_artifact":
      return `Created “${clip(args.title ?? "artifact", 60)}”`;
    case "read_artifact":
      return result?.title
        ? `Read “${clip(result.title, 60)}”`
        : "Checked this work's artifacts";
    case "edit_document":
      return result?.title
        ? `Edited “${clip(result.title, 60)}”`
        : "Edited a document";
    case "delete_artifact":
      return result?.title
        ? `Deleted “${clip(result.title, 60)}”`
        : "Deleted an artifact";
    case "start_task":
      return `Started background work “${clip(args.title, 60)}”`;
    case "get_task":
      return "Checked background work";
    case "follow_up_task":
      return "Sent feedback to background work";
    case "desktop_status":
      return "Checked the desktop app";
    case "list_dir":
      return `Looked in ${folder(args.path) || "the working folder"}`;
    case "read_file":
      return `Read ${folder(args.path)}`;
    case "git_activity":
      return args.commit
        ? `Read the changes in commit ${String(args.commit).slice(0, 7)}`
        : `Checked recent work in ${folder(args.path)}`;
    case "recent_files":
      return `Checked recently changed files in ${folder(args.path)}`;
    case "list_capture_targets":
      return "Checked which windows can be captured";
    case "screen_capture":
      return `Took a screenshot of ${captureTarget(args.target)}`;
    case "screen_record_start":
      return `Started recording ${captureTarget(args.target)}`;
    case "screen_record_stop":
      return result?.duration_seconds
        ? `Saved a ${Math.round(result.duration_seconds)} s screen recording`
        : "Stopped a screen recording";
    case "activate_plugin":
      return args.code
        ? `Activated the ${args.code} plugin`
        : "Deactivated plugins";
    case "read_skill":
      return `Read the ${args.name} skill`;
    case "browser_open":
      return `Opened ${shortUrl(args.url)}`;
    case "browser_snapshot":
      return result?.url ? `Read ${shortUrl(result.url)}` : "Read the page";
    case "browser_click":
      return result?.url ? `Clicked → ${shortUrl(result.url)}` : "Clicked";
    case "browser_type":
      return `Typed “${clip(args.text)}”${args.submit ? " and pressed Enter" : ""}`;
    case "browser_press":
      return `Pressed ${args.key}`;
    case "browser_scroll":
      return `Scrolled ${args.direction}`;
    case "browser_close":
      return "Closed a tab";
    default:
      return name;
  }
}

/** A tool call (and its result, once it exists) as a WorkAction. */
export function toolAction(
  call: TaskMessage,
  result?: TaskMessage,
): WorkAction {
  let args: Record<string, any> = {};
  try {
    args = JSON.parse(call.content.arguments ?? "{}");
  } catch {
    // Describe the tool by name alone.
  }
  const value = result?.content.result as Record<string, any> | undefined;
  const failed = !!value && typeof value === "object" && "error" in value;
  const label = describe(call.content.name ?? "Tool", args, value);
  const media = result ? messageMedia(result) : [];
  return {
    label: failed ? `${label} (failed)` : label,
    failed,
    pending: !result,
    ...(failed ? { detail: String(value.error) } : {}),
    ...(media.length ? { media } : {}),
  };
}

/** WorkActions for a turn's messages, in call order. Question cards are not actions. */
export function turnActions(messages: TaskMessage[]) {
  const results = new Map(
    messages
      .filter((m) => m.kind === "tool_result")
      .map((m) => [m.content.callId, m]),
  );
  return messages
    .filter(
      (m) => m.kind === "tool_call" && m.content.name !== "request_user_input",
    )
    .map((call) => toolAction(call, results.get(call.content.callId)));
}
