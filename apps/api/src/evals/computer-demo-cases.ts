/**
 * Product-demo evals on macOS built-in apps and the iOS Simulator. The app stands in
 * for the founder's product. Level 2 records the app while using it and delivers
 * clips; level 3 also edits them into a narrated demo video.
 * Writes happen only in the Simulator: Mac Notes, Reminders and Calendar sync to iCloud.
 */
import { homedir } from "node:os";
import type { EvalCheck, EvalEvidence } from "./computer-eval-types.js";

export type DemoApp = "maps" | "clock" | "simulator" | "web" | "desktop";
export type DemoCase = {
  id: string;
  level: 2 | 3;
  name: string;
  app: DemoApp;
  /** web: the local app's address, opened in the founder's browser. */
  url?: string;
  /** desktop: the app bundle the fixture opens, ~ for the home folder. */
  app_path?: string;
  /** Finds what to demo in the founder's recent work (the work fixture). */
  read_work?: boolean;
  /** The work fixture's script, when it isn't the Streaks one. */
  fixture_script?: string;
  brief: string;
  /** Code to script: the task ends at the script for the founder to approve, so nothing
   * is recorded or made, and the script is reviewed. */
  script_only?: boolean;
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

const introRequest = (product: string) =>
  `I haven't posted anything about ${product} yet. Can you make a launch video introducing the whole product for LinkedIn? Around 30 sec, landscape, voiceover and captions. The code is in my projects and the app is running locally; record it yourself. ${noPublish}`;
const scriptReview = (product: string, flows: string) => [
  `The script is easy to review: what ${product} is and who it's for, numbered shots with what's on screen, on-screen text and the voiceover line, the format, and what was assumed or left out.`,
  `It introduces the whole product, not only the latest commit: its core flows in the order a new user meets them (${flows}), each true to the code.`,
  "It is a straightforward product demo, like a product page introducing it: the product is the subject, with no tester feedback, bug fixes or backstory, no slogans, and nothing the code doesn't support.",
  "The opening shot has a short on-screen line naming the product, so it reads with the sound off.",
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
  // Starts where "Create content from this idea" does: an approved idea, in the words
  // queueIdeaContent sends. The idea is fixed, so recording runs can be compared.
  {
    id: "demo-tide-from-idea",
    level: 3,
    name: "From an approved idea to a product demo video (Tide web app)",
    app: "web",
    url: "http://127.0.0.1:4120",
    fixture_script: "scripts/evals/tide-fixture.mjs",
    brief: `Read the create-content skill with read_skill, then follow it for this idea.

Idea: Quick add: type a sentence to add a task

**From your work**: Tide, commits "Add quick add: type a sentence, get a dated task" and "Quick add: show date, time and project as chips while typing". Beta notes: 6 of 9 testers said adding a task takes too many clicks.

**What happened**: Adding a task used to mean a title, then a date picker, then a project. Now you type one sentence and Tide reads the date, time and project from it as you type.

**Why people would care**: Anyone who drops a todo app because capturing a task is slower than forgetting it.

**Content type**: A video demo, because the value is in watching the sentence turn into a task.

**Demo plan**: Short video, on the Today view at the top. The app runs at http://127.0.0.1:4120 (see the project's README).
1. Click the quick add box and type "Call Sam tomorrow 3pm #work". The chips for Tomorrow, 3 pm and #work appear while typing.
2. Press Enter. The task lands in Upcoming with its date, time and tag.
Say plainly what was added and why.

**Sample opening**: Testers said adding a task took too many clicks, so we added quick add.

Founder's note: Make it a ~20 sec landscape video with voiceover and captions. Record it yourself from the running app. ${noPublish}`,
    typed: ["tomorrow"],
    min_clips: 1,
    video: { seconds: [15, 35] },
    criteria: [
      "The video follows the approved idea: it shows the sentence being typed, the chips appearing, and the task landing with its date, time and tag.",
      "It says plainly what was added and why (adding a task took too many clicks), like a product page, with no slogans, and claims nothing the idea, commits and notes don't support.",
      "The recording looks like a person using the app: window in view, pointer moving, text typed key by key, no fumbling, repeated steps or long pauses.",
      ...videoReview,
    ],
  },
  // Code to script: the product introduction from its code alone, as a founder with
  // nothing posted yet asks for it. It ends at the script, so it runs on two apps cheaply
  // and checks the skill isn't fitted to one.
  {
    id: "script-tide-intro",
    level: 3,
    name: "Product introduction script from the code repo (Tide web app)",
    app: "web",
    url: "http://127.0.0.1:4120",
    fixture_script: "scripts/evals/tide-fixture.mjs",
    script_only: true,
    brief: introRequest("Tide"),
    typed: [],
    min_clips: 0,
    criteria: scriptReview("Tide", "such as adding a dated task, Today and Upcoming, quick add, checking off"),
  },
  {
    id: "script-streaks-intro",
    level: 3,
    name: "Product introduction script from the code repo (Streaks web app)",
    app: "web",
    url: "http://127.0.0.1:4110",
    fixture_script: "scripts/evals/work-fixture.mjs",
    script_only: true,
    brief: introRequest("Streaks"),
    typed: [],
    min_clips: 0,
    criteria: scriptReview("Streaks", "such as adding a habit, checking in, the streak count, the weekly recap"),
  },
  // A richer product than a list: sign in, a dashboard with a chart, invoices with line
  // items and live totals, status changes, a filter and a modal. The script has to pick
  // a few flows out of many.
  {
    id: "script-ledgerly-intro",
    level: 3,
    name: "Product introduction script from the code repo (Ledgerly invoicing SaaS)",
    app: "web",
    url: "http://127.0.0.1:4130",
    fixture_script: "scripts/evals/ledgerly-fixture.mjs",
    script_only: true,
    brief: introRequest("Ledgerly"),
    typed: [],
    min_clips: 0,
    criteria: scriptReview("Ledgerly", "such as the dashboard, creating an invoice with line items, sending it and recording the payment"),
  },
  // Script to video: starts from an approved script, fixed so recording runs compare.
  {
    id: "demo-tide-from-script",
    level: 3,
    name: "From an approved product introduction script to the video (Tide web app)",
    app: "web",
    url: "http://127.0.0.1:4120",
    fixture_script: "scripts/evals/tide-fixture.mjs",
    brief: `${introRequest("Tide")}

You sent me this script and I approved it, go ahead and make the video:

**What it is:** Tide, a calm todo app.
**Who it's for:** people with too many tabs open.
**Format:** about 30 sec, landscape 16:9 for LinkedIn, voiceover and captions.

**Shots:**
1. On screen: the Today view with its tasks. On-screen text: "Introducing Tide". Voiceover: "Introducing Tide, a calm todo app for people with too many tabs open."
2. On screen: Today, with the overdue task flagged in orange. Voiceover: "Open it and you get Today: just what's due, with what's late flagged."
3. On screen: click the quick add box and type "Call Sam tomorrow 3pm #work"; the Tomorrow, 3 pm and #work chips appear while typing. Voiceover: "To add anything, type one line. Tide pulls out the date, time and project as you type."
4. On screen: press Enter; the task lands in Upcoming, dated and tagged. Voiceover: "Hit Enter and it's filed, dated and tagged."
5. On screen: tick a task off and it moves to Completed. On-screen text: "Tide". Voiceover: "See what's next in Upcoming, and tick things off into Completed. That's Tide."`,
    typed: ["tomorrow"],
    min_clips: 2,
    video: { seconds: [20, 40] },
    criteria: [
      "The video follows the approved script: each shot in order with its voiceover line and on-screen text, the core flows shown working.",
      "It stays a straightforward product demo, like a product page introducing Tide, and claims nothing the script doesn't.",
      ...videoReview,
    ],
  },
  // A desktop app with no web way in: looking at it, and later recording it, takes
  // computer use.
  {
    id: "script-quill-intro",
    level: 3,
    name: "Product introduction script from the code repo (Quill desktop notes app)",
    app: "desktop",
    app_path: "~/PostOrca Evals/.quill-runtime/Quill.app",
    fixture_script: "scripts/evals/quill-fixture.mjs",
    script_only: true,
    brief: introRequest("Quill"),
    typed: [],
    min_clips: 0,
    criteria: scriptReview("Quill", "such as writing a note with the live preview, finding one with search, a new note from the File menu, pinning, Settings with the dark theme"),
  },
  // Script to video on a richer app: sign in off camera, a dropdown, line items added and
  // typed into, live totals and status buttons, all on camera.
  {
    id: "demo-ledgerly-from-script",
    level: 3,
    name: "From an approved product introduction script to the video (Ledgerly invoicing SaaS)",
    app: "web",
    url: "http://127.0.0.1:4130",
    fixture_script: "scripts/evals/ledgerly-fixture.mjs",
    brief: `${introRequest("Ledgerly")}

You sent me this script and I approved it, go ahead and make the video:

**What it is:** Ledgerly, invoicing for freelancers and small studios.
**Who it's for:** freelancers and small studios.
**Format:** about 30 sec, landscape 16:9 for LinkedIn, voiceover and captions.

**Shots:**
1. On screen: the Dashboard with the Outstanding, Paid and Overdue cards and the revenue chart. On-screen text: "Introducing Ledgerly". Voiceover: "Introducing Ledgerly, invoicing for freelancers and small studios."
2. On screen: the same Dashboard, the three cards. Voiceover: "See what's outstanding, what's been paid and what's overdue at a glance."
3. On screen: New invoice. Choose Juniper Studio, type "Website redesign" with a rate of 2400, click "+ Add line" and type "Copywriting", quantity 4, rate 150; the total updates to $3,000.00 while typing. Voiceover: "Pick a client, add what you did, and the total adds itself up as you type."
4. On screen: Save draft, then Mark as sent; the badge turns to Sent. Voiceover: "Save it and mark it as sent."
5. On screen: Record payment; the badge turns to Paid. On-screen text: "Ledgerly". Voiceover: "When the money lands, record the payment. That's Ledgerly."`,
    typed: ["redesign", "copywriting"],
    min_clips: 3,
    video: { seconds: [20, 45] },
    criteria: [
      "The video follows the approved script: each shot in order with its voiceover line and on-screen text, the invoice built with both line items and the total updating, then sent and paid.",
      "Sign-in happens before recording, never on camera, and the clips show no fumbling: no failed selections, wrong fields or retyped values.",
      "It stays a straightforward product demo, like a product page introducing Ledgerly, and claims nothing the script doesn't.",
      ...videoReview,
    ],
  },
  // Script to video on a desktop app: every step goes through computer use (typing,
  // a menu, search, a small button and a second window), on camera.
  {
    id: "demo-quill-from-script",
    level: 3,
    name: "From an approved product introduction script to the video (Quill desktop notes app)",
    app: "desktop",
    app_path: "~/PostOrca Evals/.quill-runtime/Quill.app",
    fixture_script: "scripts/evals/quill-fixture.mjs",
    brief: `${introRequest("Quill")}

You sent me this script and I approved it, go ahead and make the video:

**What it is:** Quill, quiet notes for your desktop.
**Format:** about 30 sec, landscape 16:9 for LinkedIn, voiceover and captions.

**Shots:**
1. On screen: the Quill window with the sidebar, the editor and the preview. On-screen text: "Introducing Quill". Voiceover: "Introducing Quill, quiet notes for your desktop."
2. On screen: in the Weekly plan note, type a new line "- [ ] Send the invites" at the end; it appears as a checklist item in the preview as you type. Voiceover: "Write in Markdown on the left, and watch it turn into clean formatting on the right as you type."
3. On screen: File, New Note, then type "# Launch checklist" as its title. Voiceover: "Start a new note from the File menu, or with Command N."
4. On screen: type "chapter" in Search notes so the list narrows to Chapter 3 ideas, then click its star to pin it. Voiceover: "Find any note with search, and pin the ones you need to the top."
5. On screen: Quill, Settings, switch Theme to Dark; the main window turns dark. On-screen text: "Quill". Voiceover: "Switch to the dark theme in Settings. That's Quill."`,
    typed: ["send the invites", "launch checklist", "chapter"],
    min_clips: 3,
    video: { seconds: [20, 40] },
    criteria: [
      "The video follows the approved script: each shot in order with its voiceover line and on-screen text, and every action visibly works (the checklist item in the preview, the new note, the narrowed and pinned list, the dark theme).",
      "The clips show no fumbling: no missed clicks, wrong menus, stray windows or retyped text, and the pointer moves like a person's.",
      "It stays a straightforward product demo, like a product page introducing Quill, and claims nothing the script doesn't.",
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
const webInputNames = new Set([
  "browser_click",
  "browser_type",
  "browser_select",
  "browser_press",
  "browser_scroll",
  "browser_hover",
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
const opensApp = (entry: DemoCase, opened: any) =>
  entry.app === "simulator"
    ? opened?.name === "Simulator" &&
      /\/Simulator\.app$/.test(opened?.path ?? "")
    : entry.app === "desktop"
      ? opened?.path === entry.app_path?.replace(/^~/, homedir())
      : opened?.path === appPaths[entry.app as "maps" | "clock"];

/** Code to script reads the project and makes nothing: no recording, video or media. */
function scriptChecks(calls: any[]): EvalCheck[] {
  const made = calls.filter((c) =>
    /^(screen_record_|video_|media_(generate|edit)_)/.test(c.name),
  );
  return [
    {
      name: "Read the project before writing the script",
      passed: calls.some((c) =>
        ["read_file", "list_dir", "git_activity"].includes(c.name),
      ),
    },
    {
      name: "Recorded and made nothing: the script comes first",
      passed: made.length === 0,
      details: made.map((c) => c.name),
    },
  ];
}

/** Checks from the product task alone; app state and clip quality are reviewed. */
export function gradeDemoCapture(
  entry: DemoCase,
  evidence: Pick<EvalEvidence, "status" | "calls" | "artifacts">,
): EvalCheck[] {
  if (entry.script_only)
    return [
      { name: "Turn completed", passed: evidence.status === "completed" },
      ...scriptChecks(evidence.calls),
    ];
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
    (c) => c.result.duration_seconds > 0 && c.result.stopped_by !== "founder",
  );
  const clipAttachments = clips.flatMap((c) => c.result.attachments ?? []);
  const clipFiles = new Set(clipAttachments.map((a: any) => a.file));
  const clipRefs = new Set(clipAttachments.map(refOf));
  const typed = ok
    .filter((c) => ["computer_type", "browser_type"].includes(c.name))
    .map((c) => String(c.args.text ?? ""));
  const firstStart = starts.length ? index(starts[0]) : -1;
  const appWindows = (c: any) =>
    new Set<string>(
      (c.result?.apps ?? [])
        .filter((app: any) =>
          opensApp(entry, app),
        )
        .flatMap((app: any) =>
          (app.windows ?? []).map((w: any) => String(w.id)),
        ),
    );
  const windowsOfApp = new Set<string>(
    ok
      .filter((c) => ["computer_list_apps", "computer_open"].includes(c.name))
      .flatMap((c) => [...appWindows(c)]),
  );
  const checks: EvalCheck[] = [
    { name: "Turn completed", passed: evidence.status === "completed" },
    {
      // An app that is already running counts once its window is actually used.
      name: "Opened the app being demonstrated",
      passed:
        entry.app === "web"
          ? ok.some(
              (c) =>
                c.name === "browser_open" &&
                String(c.args.url ?? "").startsWith(entry.url ?? "-"),
            )
          : ok.some(
              (c) =>
                c.name === "computer_open" &&
                (c.result.apps ?? []).some((app: any) =>
                  opensApp(entry, app),
                ),
            ) ||
            ok.some(
              (c) =>
                ["computer_observe", ...inputNames].includes(c.name) &&
                windowsOfApp.has(String(c.args.window)),
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
      passed: ok.some(
        (c) =>
          (inputNames.has(c.name) ||
            (entry.app === "web" && webInputNames.has(c.name))) &&
          recording(c),
      ),
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
