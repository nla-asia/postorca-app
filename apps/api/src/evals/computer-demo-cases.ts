/**
 * Product-demo evals on macOS built-in apps and the iOS Simulator. The app stands in
 * for the founder's product. Level 2 records the app while using it and delivers
 * clips; level 3 also edits them into a narrated demo video.
 * Writes happen only in the Simulator: Mac Notes, Reminders and Calendar sync to iCloud.
 */
import type { EvalCheck, EvalEvidence } from "./computer-eval-types.js";

export type DemoApp = "maps" | "clock" | "simulator" | "web";
export type DemoCase = {
  id: string;
  level: 2 | 3;
  name: string;
  app: DemoApp;
  /** web: the local app's address, opened in the founder's browser. */
  url?: string;
  /** Finds what to demo in the founder's recent work (the work fixture). */
  read_work?: boolean;
  brief: string;
  /** Text the demo has to type into the app, as regexes. product-demo-capture sets
   * the stage before recording, so this may happen on or off camera. */
  typed: string[];
  min_clips: number;
  /** Level 3 only: the finished video the runner grades with the video checks. */
  video?: { seconds: [number, number] };
  criteria: string[];
};

const appPaths: Record<"maps" | "clock", string> = {
  maps: "/System/Applications/Maps.app",
  clock: "/System/Applications/Clock.app",
};
const noPublish =
  "Don't publish anything, sign into accounts or change settings outside the app.";
const clipsReview = [
  "Every clip shows the app itself, clean and readable: no notifications, unrelated windows, personal data or leftover dialogs.",
  "The clips follow the demo in order, each a few seconds long, and the payoff stays on screen for 2–3 seconds before the clip ends.",
  "The final app state matches what the clips show and what the answer reports; nothing is claimed that the recordings don't show.",
];
const videoReview = [
  "The finished video is built from the real recordings, not stills or generated images of the app, and shows the feature working.",
  "The narration explains the feature the way a founder would to their audience: the problem, the payoff, how little it takes. It matches what is on screen at each moment.",
  "Format, length and captions fit the requested platform; the video is delivered as an MP4.",
];

export const demoCases: DemoCase[] = [
  {
    id: "demo-mac-maps-route",
    level: 2,
    name: "Record a route-planning demo in Maps",
    app: "maps",
    brief: `Pretend Apple Maps on my Mac is my product. Record short demo clips of planning a trip: get directions from Siam Paragon to the Grand Palace in Bangkok, then show the different ways to get there (driving, transit, walking) and the route on the map. Deliver the clips here. ${noPublish}`,
    typed: ["Grand Palace", "Siam Paragon"],
    min_clips: 2,
    criteria: [
      "The clips show the directions search and at least two transport modes with their routes on the map.",
      ...clipsReview,
    ],
  },
  {
    id: "demo-mac-clock-focus",
    level: 2,
    name: "Record a world-clock and timer demo in Clock",
    app: "clock",
    brief: `Pretend the Clock app on my Mac is my product. Record short demo clips of setting up a remote team's day: add world clocks for Tokyo and London, then start a 25-minute focus timer. Deliver the clips here. ${noPublish}`,
    typed: ["Tokyo", "London"],
    min_clips: 2,
    criteria: [
      "The clips show Tokyo and London added as world clocks and a 25-minute timer started.",
      ...clipsReview,
    ],
  },
  {
    id: "demo-sim-reminders-launch",
    level: 2,
    name: "Record a launch-checklist demo in Simulator Reminders",
    app: "simulator",
    brief: `Pretend the Reminders app on an iPhone in the iOS Simulator is my product. Record short demo clips of getting a launch organized: create a list called Launch, add three reminders (Write announcement, Record demo, Email beta users), give "Email beta users" a due date of tomorrow, then tick off "Write announcement". Deliver the clips here. ${noPublish}`,
    typed: ["Launch", "Write announcement", "Record demo", "Email beta users"],
    min_clips: 2,
    criteria: [
      "The clips show the Launch list created, three reminders added, a due date set and one reminder completed.",
      ...clipsReview,
    ],
  },
  {
    id: "demo-sim-maps-place",
    level: 2,
    name: "Record a place-search demo in Simulator Maps",
    app: "simulator",
    brief: `Pretend Maps on an iPhone in the iOS Simulator is my product. Record a short demo clip of finding a place: search for Bangkok, Thailand, open its place card and show what it offers. Deliver the clip here. ${noPublish}`,
    typed: ["Bangkok"],
    min_clips: 1,
    criteria: [
      "The clip shows a fresh search for Bangkok, Thailand and its place card.",
      ...clipsReview,
    ],
  },
  // Content (level 3): record the app and edit the clips into a narrated demo video.
  {
    id: "demo-work-video",
    level: 3,
    name: "Product demo video of what I just shipped (work fixture)",
    app: "web",
    url: "http://127.0.0.1:4110",
    read_work: true,
    brief: `i just shipped something in my Streaks project. make a ~20 sec demo video of it for X, landscape, voiceover + captions. record it yourself from the running app. ${noPublish}`,
    typed: [],
    min_clips: 2,
    video: { seconds: [15, 30] },
    criteria: [
      "The video demonstrates the newly shipped weekly recap card (opening it and copying the share text), found from the recent commits rather than guessed.",
      "It opens on the viewer's problem (wanting to share their week), not the feature's name, and claims nothing the commits and notes don't support.",
      ...videoReview,
    ],
  },
  {
    id: "demo-mac-maps-video",
    level: 3,
    name: "Product demo video of a Mac app (Maps)",
    app: "maps",
    brief: `demo video for linkedin, landscape, ~20 sec. pretend apple maps on my mac is my product. show planning a trip across bangkok: siam paragon to the grand palace, comparing driving vs transit. record it yourself, voiceover + captions. ${noPublish}`,
    typed: ["Grand Palace", "Siam Paragon"],
    min_clips: 2,
    video: { seconds: [15, 30] },
    criteria: videoReview,
  },
  {
    id: "demo-sim-reminders-video",
    level: 3,
    name: "Product demo video of an iOS app in the Simulator (Reminders)",
    app: "simulator",
    brief: `instagram reel, 20-30 sec, showing how i get a launch done with the reminders app on iphone (use the ios simulator, pretend it's my product). make a Launch list, add a few tasks, set a due date, tick one off. record it yourself, voiceover + captions. ${noPublish}`,
    typed: ["Launch"],
    min_clips: 2,
    video: { seconds: [18, 35] },
    criteria: videoReview,
  },
];

const inputNames = new Set([
  "computer_click",
  "computer_type",
  "computer_press",
  "computer_scroll",
]);
const refOf = (attachment: any) =>
  attachment.ref ?? String(attachment.file).split("/").at(-1)?.slice(0, 8);
const fileOf = (artifact: any) => {
  try {
    return (
      typeof artifact.content === "string"
        ? JSON.parse(artifact.content)
        : artifact.content
    )?.file;
  } catch {
    return undefined;
  }
};
const opensApp = (app: "maps" | "clock" | "simulator", opened: any) =>
  app === "simulator"
    ? opened?.name === "Simulator" &&
      /\/Simulator\.app$/.test(opened?.path ?? "")
    : opened?.path === appPaths[app];

/** Checks from the product task alone; app state and clip quality are reviewed. */
export function gradeDemoCapture(
  entry: DemoCase,
  evidence: Pick<EvalEvidence, "status" | "calls" | "artifacts">,
): EvalCheck[] {
  const ok = evidence.calls.filter((c) => c.result && !c.result.error);
  const index = (call: any) => evidence.calls.indexOf(call);
  const starts = ok.filter((c) => c.name === "screen_record_start");
  const stops = ok.filter((c) => c.name === "screen_record_stop");
  // Each recording spans its start to the stop that collected the same id.
  const spans = starts.flatMap((start) => {
    const stop = stops.find(
      (s) => s.args.id === start.result.id && index(s) > index(start),
    );
    return stop ? [[index(start), index(stop)] as const] : [];
  });
  const recording = (call: any) =>
    spans.some(([from, to]) => index(call) > from && index(call) < to);
  const clips = stops.filter(
    (c) =>
      c.result.duration_seconds > 0 && c.result.stopped_by !== "founder",
  );
  const clipAttachments = clips.flatMap((c) => c.result.attachments ?? []);
  const clipFiles = new Set(clipAttachments.map((a: any) => a.file));
  const clipRefs = new Set(clipAttachments.map(refOf));
  const typed = ok
    .filter((c) => c.name === "computer_type")
    .map((c) => String(c.args.text ?? ""));
  const firstStart = starts.length ? index(starts[0]) : -1;
  const checks: EvalCheck[] = [
    { name: "Turn completed", passed: evidence.status === "completed" },
    {
      name: "Opened the app being demonstrated",
      passed: ok.some((c) =>
        entry.app === "web"
          ? c.name === "browser_open" &&
            String(c.args.url ?? "").startsWith(entry.url ?? "-")
          : c.name === "computer_open" &&
            (c.result.apps ?? []).some((app: any) =>
              opensApp(entry.app as "maps" | "clock" | "simulator", app),
            ),
      ),
    },
    ...(entry.read_work
      ? [
          {
            name: "Read the recent work in the project's git history",
            passed: ok.some((c) => c.name === "git_activity"),
          },
        ]
      : []),
    {
      name: "Looked at the screen before recording",
      passed:
        firstStart >= 0 &&
        ok.some((c) => c.name === "screen_capture" && index(c) < firstStart),
    },
    {
      name: `Recorded at least ${entry.min_clips} clip(s)`,
      passed: clips.length >= entry.min_clips,
      details: clips.map((c) => c.result.duration_seconds),
    },
    {
      name: "Used the app while recording",
      passed: ok.some((c) => inputNames.has(c.name) && recording(c)),
    },
    ...entry.typed.map((pattern) => ({
      name: `Typed "${pattern}" in the app`,
      passed: typed.some((text) => new RegExp(pattern, "i").test(text)),
    })),
  ];
  if (entry.level === 2)
    checks.push({
      name: "Clips delivered as video artifacts",
      passed:
        evidence.artifacts.filter(
          (a) => a.kind === "video" && clipFiles.has(fileOf(a)),
        ).length >= entry.min_clips,
    });
  else {
    const exports = ok.filter((c) => c.name === "video_export");
    const clipScenes = (call: any) =>
      (call.args.scenes ?? []).filter((scene: any) =>
        clipRefs.has(scene.video_file),
      ).length;
    checks.push(
      {
        name: "Video built from the recorded clips",
        passed: exports.some((c) => clipScenes(c) >= entry.min_clips),
      },
      {
        name: "Video narrated",
        passed: exports.some((c) => !!c.args.voiceover_file),
      },
    );
  }
  return checks;
}
