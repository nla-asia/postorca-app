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
  /** Text the demo has to type into the app, as regexes. product-content-capture sets
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

const introRequest = (product: string, format = "for LinkedIn? Around 30 sec, landscape") =>
  `I haven't posted anything about ${product} yet. Can you make a launch video introducing the whole product ${format}, voiceover and captions. The code is in my projects and the app is running locally; record it yourself. ${noPublish}`;
export const scriptReview = [
  "The plan identifies the requested content type and the agent reads product-content-plan plus the matching reference file before drafting; a mix uses introduction and demo guidance.",
  "The deliverable contains a reviewable plan and complete script: intended audience, format, numbered shots with timing, narration and visual descriptions, plus meaningful assumptions. It asks for approval and stops before production.",
  "The narration reads naturally as a connected explanation in the supplied founder voice, without disconnected slogans or invented personal experiences.",
  "Each visual supports its narration. Typography, illustration, footage and animation are valid choices; product screens are optional for an introduction. If product UI or behavior is shown, the planned screen and result are supported by inspected app evidence, with unverified preparation clearly identified.",
  "All public claims, results, prices, availability and next steps are supported by supplied sources; internal notes remain private. The script does not confuse manually set statuses with actions the product performs.",
  "The actual spoken word count and per-shot timings plausibly fit the requested duration, including time to read important visuals; a claimed word count alone is not evidence."
];

const reel = "as an Instagram reel? Around 30 sec, portrait";

export const demoCases: DemoCase[] = [
  {
    id: "script-tide-demo",
    name: "Tide product demo script",
    brief: "Can you plan a product demo of Tide for LinkedIn? Walk viewers through how the product works. Landscape, with voiceover and captions. Choose suitable features to show and enough time to explain them. The code is in my projects and the app is running locally. Give me the plan and script for approval first; do not publish anything or generate assets yet.",
    criteria: [
      "General — components: All five components from the demo guide are present: opening, starting point, demonstration, transitions and close. Components can share shots, and demonstration and transitions can repeat as needed.",
      "General — explanation: It explains how the product works in plain, connected language, with enough time to follow the selected features and their results.",
      "General — accuracy: The demonstrated actions and results are supported by the product. Code and docs can support planning; an app visit is not universally required.",
      "General — delivery: It provides a reviewable plan and complete script for a landscape LinkedIn video with voiceover and captions, explains its chosen duration, asks for approval and stops before production.",
      "Specific — product: It explains the main parts of Tide that it chooses to show. Feature selection is open.",
      "Specific — demonstration: It demonstrates how someone uses Tide to organize and keep track of tasks, with a meaningful action and its result.",
      "Specific — limits: It accurately explains the selected task behavior, without inventing reminders, accounts or sharing. If quick add is shown, its interpretation of dates, times and projects and the resulting task match the product."
    ],
    level: 3,
    app: "web",
    url: "http://127.0.0.1:4120",
    fixture_script: "scripts/evals/tide-fixture.mjs",
    script_only: true,
    typed: [],
    min_clips: 0
  },
  {
    id: "script-tide-mix",
    name: "Tide product mix script",
    brief: "Can you introduce Tide to people who have never heard of it, with one short demonstration to show the main benefit? Around 35 seconds for LinkedIn, landscape, voiceover and captions. The code is in my projects and the app is running locally. Don't publish anything, sign into accounts or change settings outside the app.",
    criteria: [
      "The plan is an introduction with a focused demo beat: the script explains what the product is, who it helps and why it matters, then uses real behavior to support a promise.",
      "The demo beat has a supported starting state, meaningful action and visible result, without taking over the introduction or becoming a full walkthrough.",
      "If quick add is demonstrated, it creates a dated task accurately. Other supported task flows are valid proof beats; no reminders, accounts or sharing are invented."
    ],
    level: 3,
    app: "web",
    url: "http://127.0.0.1:4120",
    fixture_script: "scripts/evals/tide-fixture.mjs",
    script_only: true,
    typed: [],
    min_clips: 0
  },
  {
    id: "script-ledgerly-demo",
    name: "Ledgerly product demo script",
    brief: "Can you plan a product demo of Ledgerly for LinkedIn? Walk viewers through how the product works. Landscape, with voiceover and captions. Choose suitable features to show and enough time to explain them. The code is in my projects and the app is running locally. Give me the plan and script for approval first; do not publish anything or generate assets yet.",
    criteria: [
      "General — components: All five components from the demo guide are present: opening, starting point, demonstration, transitions and close. Components can share shots, and demonstration and transitions can repeat as needed.",
      "General — explanation: It explains how the product works in plain, connected language, with enough time to follow the selected features and their results.",
      "General — accuracy: The demonstrated actions and results are supported by the product. Code and docs can support planning; an app visit is not universally required.",
      "General — delivery: It provides a reviewable plan and complete script for a landscape LinkedIn video with voiceover and captions, explains its chosen duration, asks for approval and stops before production.",
      "Specific — product: It explains the main parts of Ledgerly that it chooses to show. Feature selection is open.",
      "Specific — demonstration: It demonstrates how someone uses Ledgerly to manage invoices and track what clients owe.",
      "Specific — status: It clearly distinguishes recording an invoice's status from sending an email or collecting payment."
    ],
    level: 3,
    app: "web",
    url: "http://127.0.0.1:4130",
    fixture_script: "scripts/evals/ledgerly-fixture.mjs",
    script_only: true,
    typed: [],
    min_clips: 0
  },
  {
    id: "script-ledgerly-mix",
    name: "Ledgerly product mix script",
    brief: "Can you introduce Ledgerly to people who have never heard of it, with one short demonstration to show the main benefit? Around 35 seconds for LinkedIn, landscape, voiceover and captions. The code is in my projects and the app is running locally. Don't publish anything, sign into accounts or change settings outside the app.",
    criteria: [
      "The plan is an introduction with a focused demo beat: the script explains what the product is, who it helps and why it matters, then uses real behavior to support a promise.",
      "The demo beat has a supported starting state, meaningful action and visible result, without taking over the introduction or becoming a full walkthrough.",
      "Invoice creation and status tracking are accurate; marking sent and recording payment do not send email or collect money."
    ],
    level: 3,
    app: "web",
    url: "http://127.0.0.1:4130",
    fixture_script: "scripts/evals/ledgerly-fixture.mjs",
    script_only: true,
    typed: [],
    min_clips: 0
  },
  {
    id: "script-tide-intro-no-screens",
    name: "Tide introduction with typography and animation only",
    brief: "I need a 30-second landscape introduction to Tide for LinkedIn, with voiceover and captions. Please use typography and simple animation, with no product screens or screen recordings. The code is in my projects. Don't publish anything or generate assets before I approve the script.",
    criteria: [
      "General: All required components from the product introduction guide are present: an opening, a product definition, capabilities and benefits, and a close.",
      "Specific — product: It explains what Tide is and who it is for.",
      "Specific — value: It explains how Tide helps users organize and keep track of their tasks. The agent can choose which of Tide's features best support that explanation.",
      "Specific — brief: A 30-second landscape introduction for LinkedIn, with voiceover and captions, planned using only typography and simple animation.",
    ],
    level: 3,
    app: "web",
    url: "http://127.0.0.1:4120",
    fixture_script: "scripts/evals/tide-fixture.mjs",
    script_only: true,
    typed: [],
    min_clips: 0
  },
  {
    id: "script-ledgerly-how-to",
    name: "Ledgerly how-to record an invoice payment",
    brief: "Can you plan a how-to for Ledgerly users on recording payment for an invoice? For LinkedIn, landscape, with voiceover and captions. Choose enough time to explain the task clearly. The code is in my projects and the app is running locally. Give me the plan and script for approval first; do not publish anything or generate assets yet.",
    criteria: [
      "General — components: All five components from the how-to guide are present: opening, starting point, steps, result and close. Components can share shots.",
      "General — explanation: Plain, connected instructions teach repeatable steps and a recognizable result supported by the product, with enough time to follow. Code and docs can support planning; an app visit is not universally required.",
      "General — delivery: It provides a reviewable plan and complete script for a landscape LinkedIn video with voiceover and captions, explains its chosen duration, asks for approval and stops before production.",
      "Specific — starting point: It explains which existing Ledgerly invoice is ready for recording payment, so the viewer can start from the right state.",
      "Specific — task: It explains how to record an invoice payment and recognize the updated paid state. It stays focused on that task, without an invoice-creation tutorial or whole-product walkthrough.",
      "Specific — meaning: It makes clear that recording a payment records money already received; Ledgerly is not charging the client or collecting payment."
    ],
    level: 3,
    app: "web",
    url: "http://127.0.0.1:4130",
    fixture_script: "scripts/evals/ledgerly-fixture.mjs",
    script_only: true,
    typed: [],
    min_clips: 0
  },
  {
    id: "script-packlight-intro",
    level: 3,
    name: "Product introduction script from the code repo (Packlight React Native app)",
    app: "web",
    url: "http://127.0.0.1:4140",
    fixture_script: "scripts/evals/packlight-fixture.mjs",
    script_only: true,
    brief: introRequest("Packlight", reel),
    typed: [],
    min_clips: 0,
    // What this script has to get right for this app and brief, checkable by reading it.
    criteria: [
      "This is an introduction: the spoken script names Packlight and explains it plainly as a packing checklist for trips, makes the audience clear, and gives a concrete reason to care.",
      "The opening earns attention through a relevant problem or promise. The story develops a small number of useful capabilities and closes on a credible viewer outcome; it does not require a logo opening, product screens or a step-by-step tour.",
      "Capabilities and benefits stay within the product: packing preparation, progress and optionally sending a copy of a list; no accounts, syncing, reminders, bookings, durable saved data or camera. Trip dates are labels; native sharing is iPhone-only.",
      "The story and visual plan fit the requested 30-second portrait reel; choices are selective rather than a feature inventory."
    ],
  },
  // Script to video on a mobile app, two ways: through its web version, and in the
  // iPhone Simulator for what only the native app does.
  {
    id: "demo-packlight-web-from-script",
    level: 3,
    name: "From an approved product introduction script to the video, through the web version (Packlight)",
    app: "web",
    url: "http://127.0.0.1:4140",
    fixture_script: "scripts/evals/packlight-fixture.mjs",
    brief: `${introRequest("Packlight", reel)}

You sent me this script and I approved it, go ahead and make the video:

**What it is:** Packlight, a packing list for your trips.
**Format:** about 30 sec, portrait 9:16 for Instagram, voiceover and captions.

**Shots:**
1. On screen: the sample trips, then open A weekend away. On-screen text: "Introducing Packlight". Voiceover: "Packlight keeps the little things for your trip in one place."
2. On screen: the Chiang Mai packing list at 2 of 6 packed. Voiceover: "Pick a trip and see what's packed and what's still to go."
3. On screen: add "Travel adapter", then tick Phone charger; the count becomes 3 of 7. Voiceover: "Add one more thing, tick off what's in your bag, and watch the list move toward ready."
4. On screen: open Preview packing list. On-screen text: "Packlight". Voiceover: "Check the whole list before you go. That's Packlight."`,
    typed: ["Travel adapter"],
    min_clips: 2,
    video: { seconds: [20, 40] },
    criteria: [
      "The video follows the approved shots in order on the real app, readable in portrait: Travel adapter is added, Phone charger is checked, progress becomes 3 of 7 and the preview shows the updated list.",
      "It stays a straightforward product demo, like a product page introducing Packlight, and claims nothing the script doesn't.",
      ...videoReview,
    ],
  },
  {
    id: "demo-packlight-sim-from-script",
    level: 3,
    name: "From an approved product introduction script to the video, in the iPhone Simulator (Packlight)",
    app: "simulator",
    fixture_script: "scripts/evals/packlight-fixture.mjs",
    brief: `${introRequest("Packlight", reel)}

You sent me this script and I approved it, go ahead and make the video:

**What it is:** Packlight, a packing list for your trips.
**Format:** about 30 sec, portrait 9:16 for Instagram, voiceover and captions.

**Shots:**
1. On screen: the sample trips, then open A weekend away. On-screen text: "Introducing Packlight". Voiceover: "Packlight keeps the little things for your trip in one place."
2. On screen: add "Travel adapter", then tick Phone charger; the count becomes 3 of 7. Voiceover: "Add what you need and tick things off as they go in your bag."
3. On screen: tap Share packing list; the iPhone share sheet opens with the list. Voiceover: "On iPhone, share your packing list with whoever you're travelling with."
4. On screen: close the share sheet and hold on the packing list. On-screen text: "Packlight". Voiceover: "A little less to remember. That's Packlight."

Only open and close the share sheet: don't choose anyone or send anything.`,
    typed: ["Travel adapter"],
    min_clips: 2,
    video: { seconds: [20, 40] },
    criteria: [
      "The video follows the approved shots in order in the iPhone app: Travel adapter added, Phone charger checked, 3 of 7, then the real iPhone share sheet with the list, closed without choosing anyone or sending anything.",
      "The clips show the phone screen itself, with no Simulator window frame or desktop around it, and no fumbling.",
      ...videoReview,
    ],
  },

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
    // The direction and flow this script needs; wording is the script's own.
    criteria: [
      "This is an introduction: the spoken script names Tide and explains it plainly as a calm todo app, makes the audience clear, and gives a concrete reason to care.",
      "The opening earns attention through a relevant problem or promise. The story develops a small number of useful capabilities and closes on a credible viewer outcome; it does not require a logo opening, product screens or a step-by-step tour.",
      "Capabilities and benefits stay within the product: keeping track of tasks, dates and projects; no reminders, notifications, syncing services, accounts or sharing.",
      "The story and visual plan fit the requested 30-second landscape video; choices are selective rather than a feature inventory."
    ],
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
    // The direction and flow this script needs; wording is the script's own.
    criteria: [
      "This is an introduction: the spoken script names Streaks and explains it plainly as a daily habit tracker, makes the audience clear, and gives a concrete reason to care.",
      "The opening earns attention through a relevant problem or promise. The story develops a small number of useful capabilities and closes on a credible viewer outcome; it does not require a logo opening, product screens or a step-by-step tour.",
      "Capabilities and benefits stay within the product: check-ins, streaks and the weekly recap; no reminders, accounts, syncing, social feed or additional analytics.",
      "The story and visual plan fit the requested 30-second landscape video; choices are selective rather than a feature inventory."
    ],
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
    brief: "Can you plan a product introduction video for Ledgerly for LinkedIn? Landscape, with voiceover and captions. Choose a suitable duration and visual approach. The code is in my projects and the app is running locally. Give me the plan and script for approval first; do not publish anything or generate assets yet.",
    typed: [],
    min_clips: 0,
    // The direction and flow this script needs; wording is the script's own.
    criteria: [
      "General: All required components from the product introduction guide are present: an opening, a product definition, capabilities and benefits, and a close.",
      "Specific — product: It explains what Ledgerly is and who it is for.",
      "Specific — value: It explains how Ledgerly helps users handle client invoices and understand what they are owed. The agent can choose which of Ledgerly's features best support that explanation.",
      "Specific — brief: A landscape introduction for LinkedIn, with voiceover and captions. The plan chooses and explains a suitable duration and visual approach.",
    ],
  },
  // Not every video is a product introduction. A feature launch is about one change: the
  // latest commit adds overdue invoices, among a dependency bump, a one-cent fix and an
  // older feature, with pilot notes saying why it was asked for.
  {
    id: "script-ledgerly-feature-launch",
    level: 3,
    name: "Feature launch script from the code repo (Ledgerly invoicing SaaS)",
    app: "web",
    url: "http://127.0.0.1:4130",
    fixture_script: "scripts/evals/ledgerly-fixture.mjs",
    script_only: true,
    brief: `I just shipped a new feature in Ledgerly. Can you make a short video announcing it for LinkedIn? Around 20 sec, landscape, voiceover and captions. The code is in my projects and the app is running locally. ${noPublish}`,
    typed: [],
    min_clips: 0,
    criteria: [
      "The opening establishes the relevant problem or new ability, then names Ledgerly and explains its new overdue-invoice capability early in the spoken script and on screen. A problem-first hook is valid.",
      "It gives the reason in the user's terms: seeing at a glance who hasn't paid you on time, without the pilot numbers.",
      "It explains the new overdue visibility in the user's terms, including the dashboard total/count when useful. If that UI is planned, its Overdue card and displayed data match inspected app evidence.",
      "The explanation of overdue invoices is concrete: the automatic badge or the filter makes the benefit clear. Product footage is optional; any planned badge or filter shot matches the inspected app.",
      "It makes clear this happens on its own once a sent invoice passes its due date, and doesn't claim reminders, emails to clients or late fees (Ledgerly has none).",
      "Only the feature: not a tour of Ledgerly, nothing about the cent fix, the dependency bump or older features presented as new; nothing from the pilot notes, and no developer language.",
      "The actual narration and per-shot timing plausibly fit about 20 seconds of landscape video, with room to understand the feature; no fixed shot count is required.",
    ],
  },
  // A how-to teaches one task, step by step. Sharing a packing list is iPhone-only: the
  // web version shows a line pointing to the iPhone app instead of the button, so the
  // steps have to be shown on the phone.
  {
    id: "script-packlight-how-to",
    level: 3,
    name: "How-to script from the code repo (Packlight React Native app)",
    app: "web",
    url: "http://127.0.0.1:4140",
    fixture_script: "scripts/evals/packlight-fixture.mjs",
    script_only: true,
    brief: "A few Packlight users asked how to share their packing list with whoever they're travelling with. Can you plan a quick how-to video for it, as an Instagram reel? Portrait, voiceover and captions. Choose enough time to explain the task clearly. The code is in my projects and the app is running locally. Give me the plan and script for approval first; do not publish anything or generate assets yet.",
    typed: [],
    min_clips: 0,
    criteria: [
      "General — components: All five components from the how-to guide are present: opening, starting point, steps, result and close. Components can share shots.",
      "General — explanation: Plain, connected instructions teach repeatable steps and a recognizable result supported by the product, with enough time to follow. Code and docs can support planning; an app visit is not universally required.",
      "General — delivery: It provides a reviewable plan and complete script for a portrait Instagram reel with voiceover and captions, explains its chosen duration, asks for approval and stops before production.",
      "Specific — starting point: It establishes an existing Packlight trip on the iPhone app and plans native footage, such as the iPhone Simulator. It does not substitute the web version, which lacks the sharing action.",
      "Specific — task: It teaches sharing the packing list from a trip through the iOS share sheet and explains the result: a copy of the trip's list, including which items are packed. It stays focused on sharing rather than teaching trip creation or packing.",
      "Specific — meaning: It makes clear this shares a copy, without claiming a live shared list, companion invitations or accounts.",
    ],
  },
  // A round-up of what changed: Ledgerly's last two weeks hold five user-facing features
  // (revenue chart, status filter, add a client in a modal, print to PDF, overdue), a
  // one-cent fix, a dependency bump and pilot notes; the core is older than that.
  {
    id: "script-ledgerly-whats-new",
    level: 3,
    name: "What's-new script from the code repo (Ledgerly invoicing SaaS)",
    app: "web",
    url: "http://127.0.0.1:4130",
    fixture_script: "scripts/evals/ledgerly-fixture.mjs",
    script_only: true,
    brief: `Can you make a short "what's new in Ledgerly" video covering the last two weeks, for LinkedIn? Around 30–40 sec, landscape, voiceover and captions. The code is in my projects and the app is running locally. ${noPublish}`,
    typed: [],
    min_clips: 0,
    criteria: [
      "The opening establishes that this is a what's-new piece for Ledgerly and makes the requested period clear early, on screen and in the narration.",
      "It selects useful changes from the requested period: revenue chart, status filters, add-client modal, Print / PDF and overdue invoices. Meaningful omissions are explained; selection and grouping serve the viewer rather than requiring every feature.",
      "Each selected change is explained by its user benefit. Visuals support that explanation; if product UI is planned, the screen and behavior match inspected app evidence.",
      "It is ordered for the viewer, not by commit date: for example leading with what matters most, or grouping changes by the screen they're on.",
      "The totals fix gets at most a plain line; nothing on the dependency bump, and nothing older (sign-in, the dashboard cards, the invoice form) presented as new.",
      "It claims nothing Ledgerly doesn't do (PDF is through printing; nothing is emailed or paid online); nothing from the pilot notes, and no developer language.",
      "The actual narration and shot timings fit 30–40 seconds of landscape video. Related changes may share a beat when the visuals and narration stay clear; no fixed shot count is required.",
    ],
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
    // The direction and flow this script needs; wording is the script's own.
    criteria: [
      "This is an introduction: the spoken script names Quill and explains it plainly as a desktop Markdown notes app, makes the audience clear, and gives a concrete reason to care.",
      "The opening earns attention through a relevant problem or promise. The story develops a small number of useful capabilities and closes on a credible viewer outcome; it does not require a logo opening, product screens or a step-by-step tour.",
      "Capabilities and benefits stay within the product: writing, finding and keeping notes locally; no cloud syncing, accounts, collaboration, sharing or mobile app.",
      "The story and visual plan fit the requested 30-second landscape video; choices are selective rather than a feature inventory."
    ],
  },
  // PostOrca's own repository: a real product with many features and plenty of internal
  // material, where choosing the journeys that matter is the whole job. The running app
  // is the dev desktop; recording it waits for a separate demo build.
  {
    id: "script-postorca-intro",
    level: 3,
    name: "Product introduction script from the code repo (PostOrca itself)",
    app: "desktop",
    fixture_script: "scripts/evals/postorca-fixture.mjs",
    script_only: true,
    brief: introRequest("PostOrca", "for X and LinkedIn? Around 45–60 sec, landscape"),
    typed: [],
    min_clips: 0,
    // The direction and flow this script needs; wording is the script's own.
    criteria: [
      "This is an introduction: the spoken script names PostOrca and explains it plainly as a desktop app whose agent helps builders grow their personal brand while they keep building, makes the audience clear, and gives a concrete reason to care.",
      "The opening earns attention through a relevant problem or promise. The story develops a small number of useful capabilities and closes on a credible viewer outcome; it does not require a logo opening, product screens or a step-by-step tour.",
      "Capabilities and benefits stay within the product: brand context, content work and founder review; no automatic posting or audience-growth promises, and no private provider, pricing or operational details.",
      "The story and visual plan fit the requested 45\u201360-second landscape video; choices are selective rather than a feature inventory."
    ],
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
2. On screen: in the Weekly plan note, type a new line "- Send the invites" at the end; it appears as a new list item in the preview as you type. Voiceover: "Write in Markdown on the left, and watch it turn into clean formatting on the right as you type."
3. On screen: File, New Note, then type "# Launch checklist" as its title. Voiceover: "Start a new note from the File menu, or with Command N."
4. On screen: type "ideas" in Search notes so the list narrows to Chapter 3 ideas, then click its star to pin it. Voiceover: "Find any note with search, and pin the ones you need to the top."
5. On screen: Quill, Settings, switch Theme to Dark; the main window turns dark. On-screen text: "Quill". Voiceover: "Switch to the dark theme in Settings. That's Quill."`,
    typed: ["send the invites", "launch checklist", "ideas"],
    min_clips: 3,
    video: { seconds: [20, 40] },
    criteria: [
      "The video follows the approved script: each shot in order with its voiceover line and on-screen text, and every action visibly works (the new list item in the preview, the new note, the narrowed and pinned list, the dark theme).",
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
  "computer_drag",
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

/** localhost and 127.0.0.1 are the same local app. */
const local = (url: string) => url.replace("//localhost:", "//127.0.0.1:");

/** Code to script reads the project and makes nothing: no recording, video or media. */
function scriptChecks(calls: any[]): EvalCheck[] {
  const ok = calls.filter((c) => c.result && !c.result.error && !c.failed);
  // What was made, not what was tried: a content task refuses to make anything early.
  const made = ok.filter((c) =>
    /^(screen_record_|video_|media_(generate|edit)_)/.test(c.name),
  );
  const saved = (name: string) =>
    ok.some((c) => c.name === "save_content_file" && c.args?.name === name);
  // Artifact-only delivery is still a draft. Missing named saves is a separate
  // failure and must not erase a source read that happened before that draft.
  const firstDraft = calls.findIndex((c) =>
    ok.includes(c) && (c.name === "save_content_file" ||
      (c.name === "create_artifact" && c.args?.kind === "document")),
  );
  return [
    {
      name: "Read the project before writing the script",
      passed: ok.some((c) =>
        ["read_file", "list_dir", "git_activity"].includes(c.name) &&
        (firstDraft < 0 || calls.indexOf(c) < firstDraft),
      ),
    },
    {
      name: "Recorded and made nothing: the script comes first",
      passed: made.length === 0,
      details: made.map((c) => c.name),
    },
    {
      name: "Saved the plan and the script in the task's folder",
      passed: saved("plan.md") && saved("script.md"),
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
                local(String(c.args.url ?? "")).startsWith(local(entry.url ?? "-")),
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
        ok.some(
          (c) =>
            ["screen_capture", "computer_observe"].includes(c.name) &&
            index(c) < firstStart,
        ),
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
