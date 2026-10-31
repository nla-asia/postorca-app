import type { EvalCheck, EvalEvidence } from "./computer-eval-types.js";

/**
 * Editing evals: the founder's screen recordings are given (fixtures/evals/recordings),
 * so the agent edits rather than records. A professional product demo is more than the
 * recordings played back; the review holds it to that bar.
 */
export type EditCase = {
  id: string;
  name: string;
  /** The recording set in fixtures/evals/recordings, copied to the working folder. */
  set: string;
  clips: string[];
  /** A track the founder hands over with the recordings, in the same folder. */
  music?: string;
  brief: string;
  video: { seconds: [number, number] };
  criteria: string[];
};

const noPublish = "Don't publish anything.";

/** What a professional product demo video does, for any product. */
const professional = [
  "Structure: it opens on a hook that names the product and what it does before or as the first screen appears, each flow is introduced so the viewer knows what they are about to see, and it ends on an end card with the product's name and what it does, held long enough to read.",
  "Framing: every recording is cropped and framed so nothing recorded around the app shows (browser tabs, address bar, debugging banner, window title bar, desktop), and the app is large enough to read on a phone.",
  "Guiding the eye: at each key moment (the action and its result) the viewer's eye is led to it, by zooming in, a callout or a highlight, timed to when it happens on screen.",
  "Motion and pacing: no dead air or waiting; long typing and loading are cut or sped up; cuts and zooms are smooth and the rhythm stays even from start to end.",
  "Text: titles, labels and captions are short, in one consistent style, never cover the action, and the captions match the voiceover.",
  "Sound: the voiceover is clear and follows the screen; any music sits under the voice.",
  "Overall: it looks like a launch video a good software company would post, and holds the viewer to the end; it is not the recordings played back with captions.",
];

export const editCases: EditCase[] = [
  {
    id: "edit-ledgerly-launch",
    name: "Edit given recordings into a professional product demo (Ledgerly)",
    set: "ledgerly",
    clips: ["1-dashboard.mp4", "2-new-invoice.mp4", "3-mark-sent.mp4", "4-record-payment.mp4"],
    music: "music.mp3",
    brief: `I recorded my invoicing app Ledgerly for its launch video. The recordings are in my working folder, in eval-fixtures/ledgerly-recordings: 1-dashboard, 2-new-invoice, 3-mark-sent and 4-record-payment, with music.mp3, a track I picked for it. Please edit them into a polished launch video for LinkedIn: landscape, around 30–40 sec, voiceover and captions. I want it to look like the product videos good SaaS companies post, not just my recordings played back.

The script I approved:
1. The dashboard. Voiceover: "Introducing Ledgerly, invoicing for freelancers and small studios."
2. The dashboard's cards. Voiceover: "See what's outstanding, what's been paid and what's overdue at a glance."
3. A new invoice for Juniper Studio with two line items; the total updates to $3,000. Voiceover: "Pick a client, add what you did, and the total adds itself up as you type."
4. Save it and mark it as sent. Voiceover: "Save it and mark it as sent."
5. Record the payment; it turns Paid. Voiceover: "When the money lands, record the payment. That's Ledgerly."

${noPublish}`,
    video: { seconds: [25, 45] },
    criteria: [
      "It follows the approved script: every line spoken over the screen it describes, the invoice built with both line items and the $3,000 total, then sent and paid.",
      ...professional,
    ],
  },
  {
    // A desktop app, not a website: window recordings with a title bar instead of a
    // browser's bars, a different layout, and a calm track for a walkthrough.
    id: "edit-quill-walkthrough",
    name: "Edit given recordings into a professional product demo (Quill desktop app)",
    set: "quill",
    clips: ["1-window.mp4", "2-write.mp4", "3-new-note.mp4", "4-search-pin.mp4", "5-dark-theme.mp4"],
    music: "sleepy-cat.mp3",
    brief: `I recorded my Mac notes app Quill for a short walkthrough. The recordings are in my working folder, in eval-fixtures/quill-recordings: 1-window, 2-write, 3-new-note, 4-search-pin and 5-dark-theme, with sleepy-cat.mp3, a calm track I like for it. Please edit them into a polished walkthrough video for LinkedIn and my site: landscape, around 30 sec, voiceover and captions. Quill is a quiet app, so keep the video calm and clean, the way Apple or Linear show a feature, not my raw recordings played back.

The script I approved:
1. The Quill window. Voiceover: "Introducing Quill, quiet notes for your desktop."
2. Typing a new line in Weekly plan; it shows up in the preview. Voiceover: "Write in Markdown on the left, and watch it turn into clean formatting on the right as you type."
3. A new note from the File menu, titled Launch checklist. Voiceover: "Start a new note from the File menu, or with Command N."
4. Searching "ideas", then pinning Chapter 3 ideas. Voiceover: "Find any note with search, and pin the ones you need to the top."
5. Settings, Theme to Dark. Voiceover: "Switch to the dark theme in Settings. That's Quill."

${noPublish}`,
    video: { seconds: [22, 40] },
    criteria: [
      "It follows the approved script: every line spoken over the screen it describes, the new line appearing in the preview, the new note, the narrowed and pinned list, and the window turning dark.",
      ...professional,
    ],
  },
];

const valuesOf = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(valuesOf)
      : [];

/** Checks from the task: the given recordings are edited, not re-recorded. */
export function gradeEdit(
  entry: EditCase,
  evidence: Pick<EvalEvidence, "status" | "calls" | "artifacts">,
): EvalCheck[] {
  const ok = evidence.calls.filter((c) => c.result && !c.result.error);
  // A file comes in through upload_file, or read_file for one Orca also looks at.
  const uploads = ok.filter((c) => c.name === "upload_file" || c.name === "read_file");
  const uploaded = entry.clips.filter((clip) =>
    uploads.some((c) => String(c.args.path ?? "").endsWith(clip)),
  );
  // A scene's video_file is a ref the upload or read returned (or a prefix of its key).
  const refs = uploads.flatMap((c) => valuesOf(c.result));
  const fromUpload = (file: unknown) =>
    typeof file === "string" && file.length >= 6 && refs.some((r) => r === file || r.includes(file));
  const exports = ok.filter((c) => c.name === "video_export");
  const last = exports.at(-1);
  const scenes: any[] = last?.args.scenes ?? [];
  const used = new Set(scenes.filter((s) => fromUpload(s.video_file)).map((s) => s.video_file));
  return [
    { name: "Turn completed", passed: evidence.status === "completed" },
    {
      name: "Brought in the founder's recordings",
      passed: uploaded.length === entry.clips.length,
      details: uploaded,
    },
    {
      name: "Video built from the founder's recordings",
      passed: used.size >= entry.clips.length - 1,
      details: { recordings_used: used.size, scenes: scenes.length },
    },
    { name: "Video narrated", passed: !!last?.args.voiceover_file },
    ...(entry.music
      ? [
          {
            name: "Used the founder's track under the voice",
            passed:
              uploads.some((c) => String(c.args.path ?? "").endsWith(entry.music!)) &&
              fromUpload(last?.args.music?.file),
          },
        ]
      : []),
    {
      // Looking at the app (or searching for music) is fine; recording it again isn't.
      name: "Edited, not re-recorded",
      passed: !evidence.calls.some((c) => /^(screen_record_|computer_)/.test(c.name)),
      details: evidence.calls.filter((c) => /^(screen_record_|computer_)/.test(c.name)).map((c) => c.name),
    },
  ];
}
