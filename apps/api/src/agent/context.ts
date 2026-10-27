import { readFileSync } from "node:fs";
import type { Database } from "../db.js";
import type { Provider, StoredMessage } from "../providers/types.js";
import {
  saveTaskContext,
  taskContext,
  taskHistory,
} from "../repositories/tasks.js";
import type { TurnTrace } from "./trace.js";
import { CONTEXT_WINDOW_TOKENS, estimateTokens } from "./tokens.js";
import { fileRef, isUserFileKey, loadFile } from "../storage.js";

/**
 * What the model sees of a task's history. The founder always sees the full history;
 * the model sees a summary of compacted messages plus the messages after it.
 * Text tool results remain available until compaction; only image payloads expire.
 *
 * Compaction follows the autopilot backend: when the estimated request size passes
 * the window, older messages are summarized by a separate model call and the summary
 * is saved as a checkpoint (task_context.through_message_id). The most recent steps
 * stay verbatim so tool calls and their results remain paired.
 */
const COMPACT_AT_TOKENS = CONTEXT_WINDOW_TOKENS;
/** Assistant responses (with their tool results) kept verbatim after compaction. */
const KEEP_RECENT_STEPS = 4;
/**
 * Tool images are shown for this many model responses, then only their reference.
 * The model notes what it saw in the response that sees an image, and hiding the image
 * right after changes only the end of the history, so the cached prompt before it is
 * kept. AGENT_IMAGE_STEPS can show images longer (each frame costs about 1–3k tokens).
 */
const IMAGE_RESULT_STEPS = Math.max(
  1,
  Number(process.env.AGENT_IMAGE_STEPS) || 1,
);
/** No single tool result may take more than this, even in a recent step. */
const MAX_RESULT_CHARS = 80_000;
/** Cap on what the compaction call reads; older transcript beyond it is dropped. */
const MAX_TRANSCRIPT_CHARS = 300_000;
const TRANSCRIPT_RESULT_CHARS = 2_000;
const TRANSCRIPT_TEXT_CHARS = 4_000;

const compactionPrompt = readFileSync(
  new URL("./prompts/compaction.md", import.meta.url),
  "utf8",
).trim();

const summaryMessage = (summary: string): StoredMessage => ({
  id: "0",
  turn_id: "",
  kind: "user",
  content: {
    text: `[Summary of the earlier conversation, compacted to save context. The full history is still visible to the founder.]\n\n${summary}`,
  },
  created_at: "",
});

/**
 * The model's view of stored messages: the summary first, then the messages after
 * it, with oversized individual tool results cut regardless of age.
 */
export function modelMessages(
  messages: StoredMessage[],
  summary?: string,
): StoredMessage[] {
  const shaped = messages.map((message) => {
    if (message.kind !== "tool_result") return message;
    const result = JSON.stringify(message.content.result) ?? "";
    if (result.length > MAX_RESULT_CHARS)
      return {
        ...message,
        content: {
          ...message.content,
          result: `${result.slice(0, MAX_RESULT_CHARS)}\n[Result truncated to fit the context.]`,
        },
      };
    return message;
  });
  return [...(summary ? [summaryMessage(summary)] : []), ...shaped];
}

/**
 * Plain-text transcript for the compaction call. Founder messages are always kept;
 * when it is too long, the oldest of Orca's messages and tool lines go first.
 */
function transcript(messages: StoredMessage[], summary?: string) {
  const clip = (text: string, limit: number) =>
    text.length > limit ? `${text.slice(0, limit)} [truncated]` : text;
  const lines = messages.flatMap(({ kind, content }) => {
    if (kind === "user")
      return [{ founder: true, text: `Founder: ${content.text}` }];
    const text =
      kind === "assistant"
        ? content.text && `Orca: ${clip(content.text, TRANSCRIPT_TEXT_CHARS)}`
        : kind === "tool_call"
          ? `Orca called ${content.name}(${clip(content.arguments, TRANSCRIPT_RESULT_CHARS)})`
          : `Tool result: ${clip(JSON.stringify(content.result) ?? "", TRANSCRIPT_RESULT_CHARS)}`;
    return text ? [{ founder: false, text }] : [];
  });
  let length = lines.reduce((total, line) => total + line.text.length + 2, 0);
  let omitted = false;
  for (const line of lines) {
    if (length <= MAX_TRANSCRIPT_CHARS) break;
    if (line.founder) continue;
    length -= line.text.length + 2;
    line.text = "";
    omitted = true;
  }
  const body = lines
    .filter((line) => line.text)
    .map((line) => line.text)
    .join("\n\n");
  return `${summary ? `Earlier summary:\n${summary}\n\n` : ""}Transcript:${omitted ? " (some older messages from Orca and tools omitted)" : ""}\n${body}`;
}

/**
 * Summarizes everything before the last `keepSteps` assistant responses and saves the
 * checkpoint. Returns false when there is nothing old enough to compact.
 */
export async function compactTask(
  db: Database,
  provider: Provider,
  taskId: string,
  options: { keepSteps: number; signal: AbortSignal; trace?: TurnTrace },
) {
  const saved = await taskContext(db, taskId);
  const messages = await taskHistory(db, taskId, saved?.through_message_id);
  // Cut at an assistant response, so no tool call is separated from its result.
  let cut = messages.length;
  for (let kept = 0; cut > 0 && kept < options.keepSteps;)
    if (messages[--cut].kind === "assistant") kept++;
  if (cut === 0) return false;
  const response = await provider.respond({
    instructions: compactionPrompt,
    messages: [
      {
        ...summaryMessage(""),
        content: {
          text: transcript(messages.slice(0, cut), saved?.summary),
        },
      },
    ],
    tools: [],
    signal: options.signal,
    trace: options.trace,
  });
  if (!response.text.trim()) return false;
  await saveTaskContext(db, taskId, response.text, messages[cut - 1].id);
  return true;
}

/**
 * On every result with images, shown or hidden: the result's text never changes when
 * its images are hidden, so the prompt cached before them stays reusable.
 */
const IMAGES_NOTE =
  "Shown to you once, in the step right after this result. Afterwards rely on your description of them, or take a new screenshot if you need to look again.";

/**
 * Images from recent tool results (e.g. screenshots, generated images, video frames),
 * loaded from storage onto those messages as content.images. Older requests keep only
 * the file reference and the model's own description of the image. Files not owned by
 * the user are ignored.
 */
async function attachRecentImages(messages: StoredMessage[], userId: string) {
  const stepsAfter: number[] = [];
  for (let index = messages.length - 1, steps = 0; index >= 0; index--) {
    if (messages[index].kind === "assistant") steps++;
    stepsAfter[index] = steps;
  }
  return Promise.all(
    messages.map(async (message, index) => {
      const attachments = message.content?.result?.attachments;
      if (
        !Array.isArray(attachments) ||
        !attachments.some((a) => /\.(png|jpg)$/.test(String(a?.file)))
      )
        return message;
      const noted = {
        ...message,
        content: {
          ...message.content,
          result: { ...message.content.result, images: IMAGES_NOTE },
          // Marks the step for a cache breakpoint (see the OpenAI provider).
          hadImages: true,
        },
      };
      if (stepsAfter[index] >= IMAGE_RESULT_STEPS) return noted;
      const images = [];
      for (const attachment of attachments) {
        // Original downloads can be very large. Visual browsing uses screenshots;
        // do not silently feed entire originals back into every model request.
        if (attachment?.kind === "download") continue;
        if (!isUserFileKey(userId, String(attachment?.file))) continue;
        if (
          !["image/png", "image/jpeg"].includes(attachment?.mime_type) ||
          !/\.(png|jpg)$/.test(attachment.file)
        )
          continue;
        const data = await loadFile(attachment.file).catch(() => null);
        if (data)
          images.push({
            mime_type: attachment.mime_type,
            base64: data.toString("base64"),
          });
      }
      return images.length
        ? { ...noted, content: { ...noted.content, images } }
        : noted;
    }),
  );
}

/**
 * The model refers to files by ref (the tools accept refs), so tool results show each
 * attachment's ref instead of its storage key: a long key invites copying mistakes.
 */
function withRefs(messages: StoredMessage[]) {
  return messages.map((message) => {
    const attachments = message.content?.result?.attachments;
    if (!Array.isArray(attachments)) return message;
    return {
      ...message,
      content: {
        ...message.content,
        result: {
          ...message.content.result,
          attachments: attachments.map(({ file, ...rest }) =>
            typeof file === "string" ? { ref: fileRef(file), ...rest } : rest,
          ),
        },
      },
    };
  });
}

/**
 * Messages for the next model request, compacting first when the request would pass
 * the window. A failed compaction is logged and the request proceeds uncompacted.
 */
export async function loadModelContext(
  db: Database,
  provider: Provider,
  task: { taskId: string; userId: string },
  request: { instructions: string; signal: AbortSignal; trace?: TurnTrace },
) {
  const { taskId } = task;
  const load = async () => {
    const saved = await taskContext(db, taskId);
    return modelMessages(
      await taskHistory(db, taskId, saved?.through_message_id),
      saved?.summary,
    );
  };
  const messages = await load();
  if (estimateTokens([request.instructions, messages]) <= COMPACT_AT_TOKENS)
    return withRefs(await attachRecentImages(messages, task.userId));
  try {
    const compacted = await compactTask(db, provider, taskId, {
      keepSteps: KEEP_RECENT_STEPS,
      signal: request.signal,
      trace: request.trace && {
        ...request.trace,
        step: `${request.trace.step}-compaction`,
      },
    });
    return withRefs(
      await attachRecentImages(
        compacted ? await load() : messages,
        task.userId,
      ),
    );
  } catch (error) {
    request.signal.throwIfAborted();
    console.warn(
      `Context compaction failed for task ${taskId}:`,
      error instanceof Error ? error.message : error,
    );
    return withRefs(await attachRecentImages(messages, task.userId));
  }
}
