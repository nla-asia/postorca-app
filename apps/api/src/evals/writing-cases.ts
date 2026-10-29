/**
 * Writing (level 2) and text-based Content (level 3) evals. They need the founder's
 * real brand profile and voice, so the reviewer judges voice; the programmatic
 * checks cover platform format, supplied facts and how the work was delivered.
 */
import type { EvalCheck } from "./computer-eval-types.js";

export type WritingExpect = {
  /** One document per platform, titled with the platform. */
  docs?: ("x" | "linkedin")[];
  /** A reply drafted with create_reply. */
  reply?: boolean;
  /** Supplied facts every deliverable keeps, as regexes. */
  must_include?: string[];
  /** The facts are supplied, so no [placeholder] may remain. */
  no_placeholders?: boolean;
  /** Final LinkedIn word limit after a revision request. */
  max_words?: number;
  /** The last turn revises the existing document instead of creating another. */
  edited_in_place?: boolean;
  /** An image made with the media tools is delivered alongside the text. */
  image?: boolean;
  /** Browsing happens before the first written deliverable. */
  research?: boolean;
};
export type WritingCase = {
  id: string;
  category: "writing" | "content";
  level: 2 | 3;
  name: string;
  turns: string[];
  expect: WritingExpect;
  criteria: string[];
  parameters?: boolean;
};

const voice = [
  "Sounds like the founder: follows their voice and recent posts on that platform, not generic marketing copy.",
  "Says something real the founder can own; the first line works on its own and stops someone scrolling.",
  "No invented facts, numbers, customers or personal stories beyond what the founder supplied or their profile and memory record.",
];

export const writingCases: WritingCase[] = [
  {
    id: "post-in-voice",
    category: "writing",
    level: 2,
    name: "Post in my voice for X and LinkedIn",
    turns: [
      "Write a post about this for X and LinkedIn: last week we cut Autopilot Startup's onboarding from 9 minutes to 4 by removing the workspace setup step, and the share of signups who finish onboarding went from 41% to 63%. Don't publish anything.",
    ],
    expect: {
      docs: ["x", "linkedin"],
      must_include: ["\\b(9|nine)\\b", "\\b(4|four)\\b", "41\\s?%", "63\\s?%"],
      no_placeholders: true,
    },
    criteria: [
      ...voice,
      "Each version fits its platform; the change and its result are the spine of the post, not decoration.",
    ],
  },
  {
    id: "reply-in-voice",
    category: "writing",
    level: 2,
    name: "Reply to a conversation in my voice",
    turns: [
      `Draft a reply in my voice to this post on X by Maya Chen (@mayabuilds): "Every AI agent demo looks great until it touches a real customer's data. What broke first for you?" Don't post it.`,
    ],
    expect: { reply: true },
    criteria: [
      ...voice,
      "The reply adds something specific to Maya's question instead of restating it; where it needs the founder's own experience that isn't on record, it asks or leaves a marked placeholder rather than inventing one.",
    ],
  },
  {
    id: "revise-from-feedback",
    category: "writing",
    level: 2,
    name: "Revise a post from feedback",
    turns: [
      "Write a LinkedIn post about this: last week we cut Autopilot Startup's onboarding from 9 minutes to 4 by removing the workspace setup step, and the share of signups who finish onboarding went from 41% to 63%. Don't publish anything.",
      "Too polished, it sounds like marketing. Make it more personal and cut it to under 120 words.",
    ],
    expect: {
      docs: ["linkedin"],
      must_include: ["\\b(9|nine)\\b", "\\b(4|four)\\b", "41\\s?%", "63\\s?%"],
      no_placeholders: true,
      max_words: 120,
      edited_in_place: true,
    },
    criteria: [
      ...voice,
      "The revision answers the feedback (more personal, less marketing) and keeps what already worked; the supplied facts are unchanged.",
    ],
  },
];

const platformTitle = { x: /\b(X|Twitter)\b/, linkedin: /LinkedIn/i };
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
/** The post itself: create-content delivers it first, then "Other openings" and
 * "Placeholders" notes (often after a --- rule), which are not part of the post. */
export const postBody = (content: string) =>
  content
    .split(/\n\s*(?:-{3,}|\**Other openings:?\**:?)\s*(?:\n|$)/i)[0]
    .trim();
const parse = (content: any) => {
  try {
    return typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return undefined;
  }
};

export function gradeWriting(
  expect: WritingExpect,
  evidence: { status: string; turns: any[]; calls: any[] },
): EvalCheck[] {
  const artifacts = evidence.turns.flatMap((t) => t.artifacts ?? []);
  const documents = artifacts.filter((a) => a.kind === "document");
  const ok = evidence.calls.filter((c) => !c.failed);
  const checks: EvalCheck[] = [
    { name: "Turn completed", passed: evidence.status === "completed" },
  ];
  const delivered: string[] = [];
  for (const platform of expect.docs ?? []) {
    const doc = documents.find((d) => platformTitle[platform].test(d.title));
    const text = postBody(String(doc?.content ?? ""));
    if (doc) delivered.push(text);
    checks.push({
      name: `${platform === "x" ? "X" : "LinkedIn"} post delivered as its own document`,
      passed: !!doc,
    });
    if (!doc) continue;
    if (platform === "x") {
      // A thread is numbered 1/, 2/, …; each post keeps to 280 characters.
      const posts = text.split(/\n\s*\n?(?=\d+\/)/).map((p) => p.trim());
      checks.push(
        {
          name: "X posts within 280 characters",
          passed: posts.every((p) => [...p].length <= 280),
          details: posts.map((p) => [...p].length),
        },
        {
          name: "At most one hashtag on X",
          passed: (text.match(/(^|\s)#\w/g) ?? []).length <= 1,
        },
      );
    } else {
      const count = words(text);
      const [min, max] = expect.max_words ? [1, expect.max_words] : [100, 250];
      checks.push(
        {
          name: `LinkedIn post ${min}–${max} words`,
          passed: count >= min && count <= max,
          details: count,
        },
        {
          name: "No hashtags on LinkedIn",
          passed: !/(^|\s)#\w/.test(text),
        },
      );
    }
  }
  if (expect.reply) {
    const reply = artifacts
      .filter((a) => a.kind === "reply")
      .map((a) => parse(a.content))
      .find(Boolean);
    if (reply?.text) delivered.push(String(reply.text));
    checks.push(
      { name: "Reply drafted with create_reply", passed: !!reply?.text },
      {
        name: "Reply within 280 characters",
        passed: !!reply?.text && [...String(reply.text)].length <= 280,
      },
    );
  }
  for (const pattern of expect.must_include ?? [])
    checks.push({
      name: `Keeps the supplied fact /${pattern}/`,
      passed:
        delivered.length > 0 &&
        delivered.every((text) => new RegExp(pattern, "i").test(text)),
    });
  if (expect.no_placeholders)
    checks.push({
      name: "No placeholders left",
      passed: delivered.every((text) => !/\[[^\]\n]+\]/.test(text)),
    });
  if (expect.edited_in_place) {
    const last = evidence.turns.at(-1)?.id;
    const lastCalls = ok.filter((c) => c.turn_id === last);
    checks.push({
      name: "Revised the existing document in place",
      passed:
        lastCalls.some((c) => c.name === "edit_document") &&
        !lastCalls.some(
          (c) => c.name === "create_artifact" && c.args?.kind === "document",
        ),
    });
  }
  if (expect.image) {
    const made = new Set(
      ok
        .filter((c) =>
          ["media_generate_image", "media_edit_image"].includes(c.name),
        )
        .flatMap((c) => c.result?.attachments ?? [])
        .map((a: any) => a.file),
    );
    checks.push({
      name: "Generated image delivered",
      passed: artifacts.some(
        (a) => a.kind === "image" && made.has(parse(a.content)?.file),
      ),
    });
  }
  if (expect.research) {
    const firstDoc = evidence.calls.findIndex(
      (c) => c.name === "create_artifact" && c.args?.kind === "document",
    );
    checks.push({
      name: "Researched in the browser before writing",
      passed:
        firstDoc > 0 &&
        evidence.calls
          .slice(0, firstDoc)
          .some((c) => c.name.startsWith("browser_") && !c.failed),
    });
  }
  return checks;
}

/** Writing tool health (level 1): documents, in-place edits, replies and saved posts. */
export const writingToolsCase = {
  id: "tools",
  name: "Every writing tool: document, read, edit in place, reply, saved posts",
  brief: `This is a temporary check of the writing tools. 1) Save a document titled "Tool check" containing exactly: Shipping beats polishing. 2) Read it back, then change "beats" to "wins over" in that same document. 3) Draft a reply on X to Maya Chen (@mayabuilds), whose post says "What broke first for you?", with exactly: Same here. 4) Find my most recent saved post and tell me its first line. Don't publish or post anything, or save memory.`,
  criteria: [
    "The first line reported is the first line of the founder's most recent saved post.",
  ],
};

export function gradeWritingTools(evidence: {
  status: string;
  calls: any[];
  artifacts: any[];
}): EvalCheck[] {
  const ok = evidence.calls.filter((c) => !c.failed);
  const used = (name: string) => ok.filter((c) => c.name === name);
  const doc = evidence.artifacts.find(
    (a) => a.kind === "document" && /tool check/i.test(a.title ?? ""),
  );
  const reply = evidence.artifacts
    .filter((a) => a.kind === "reply")
    .map((a) => parse(a.content))
    .find(Boolean);
  return [
    { name: "Turn completed", passed: evidence.status === "completed" },
    {
      name: "Document created",
      passed: used("create_artifact").some((c) => c.args?.kind === "document"),
    },
    { name: "Document read back", passed: used("read_artifact").length > 0 },
    {
      name: "Edited in place to the exact text",
      passed:
        used("edit_document").length > 0 &&
        String(doc?.content ?? "").trim() === "Shipping wins over polishing.",
      details: doc?.content,
    },
    {
      name: "Only one Tool check document",
      passed:
        evidence.artifacts.filter(
          (a) => a.kind === "document" && /tool check/i.test(a.title ?? ""),
        ).length === 1,
    },
    {
      name: "Reply drafted with the exact text",
      passed: String(reply?.text ?? "").trim() === "Same here.",
    },
    {
      name: "Saved posts read",
      passed:
        used("list_my_posts").length + used("search_my_posts").length > 0,
    },
  ];
}
