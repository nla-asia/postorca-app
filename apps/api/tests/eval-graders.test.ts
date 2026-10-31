import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeWriting,
  gradeWritingTools,
  postBody,
  writingCases,
} from "../src/evals/writing-cases.js";
import { gradeBrowserTools } from "../src/evals/browser-tools.js";
import { gradeIdeas, ideasCases } from "../src/evals/ideas-cases.js";
import {
  gradeMediaTools,
  gradeQuoteCard,
  gradeVoiceover,
  mediaSentence,
} from "../src/evals/media-cases.js";

const expect = (id: string) => writingCases.find((c) => c.id === id)!.expect;
const failed = (checks: { name: string; passed: boolean }[]) =>
  checks.filter((c) => !c.passed).map((c) => c.name);
const linkedin =
  "Last week we cut onboarding from 9 minutes to 4. " +
  "We removed one step. ".repeat(25) +
  "Completion went from 41% to 63%.";
const doc = (title: string, content: string) => ({
  kind: "document",
  title,
  content,
});

test("writing checks platform format and supplied facts", () => {
  const turns = [
    {
      id: "t1",
      status: "completed",
      artifacts: [
        doc(
          "X",
          "Cut onboarding from 9 min to 4. Completion: 41% → 63%. #buildinpublic",
        ),
        doc("LinkedIn", linkedin),
      ],
    },
  ];
  assert.deepEqual(
    failed(
      gradeWriting(expect("post-in-voice"), {
        status: "completed",
        turns,
        calls: [],
      }),
    ),
    [],
  );
  turns[0].artifacts = [
    doc(
      "X post",
      `1/ ${"a".repeat(300)}\n\n2/ Completion went from 41% to 63%.`,
    ),
    doc("LinkedIn", `${linkedin} #startups [your metric]`),
  ];
  assert.deepEqual(
    failed(
      gradeWriting(expect("post-in-voice"), {
        status: "completed",
        turns,
        calls: [],
      }),
    ),
    [
      "X posts within 280 characters",
      "No hashtags on LinkedIn",
      "Keeps the supplied fact /\\b(9|nine)\\b/",
      "Keeps the supplied fact /\\b(4|four)\\b/",
      "No placeholders left",
    ],
  );
});

test("a revision must edit the existing document and meet the new length", () => {
  const short =
    "Last week we cut onboarding from 9 minutes to 4, and completion went from 41% to 63%.";
  const turns = [
    { id: "t1", status: "completed", artifacts: [doc("LinkedIn", short)] },
    { id: "t2", status: "completed", artifacts: [] },
  ];
  const edit = {
    name: "edit_document",
    turn_id: "t2",
    args: { id: "a1" },
    result: {},
  };
  const create = {
    name: "create_artifact",
    turn_id: "t2",
    args: { kind: "document" },
    result: {},
  };
  const grade = (calls: any[]) =>
    failed(
      gradeWriting(expect("revise-from-feedback"), {
        status: "completed",
        turns,
        calls,
      }),
    );
  assert.deepEqual(grade([edit]), []);
  assert.deepEqual(grade([create]), ["Revised the existing document in place"]);
});

test("research must come before writing; image posts need a generated image", () => {
  const turns = [
    {
      id: "t1",
      status: "completed",
      artifacts: [doc("X", "take"), doc("LinkedIn", linkedin)],
    },
  ];
  const write = {
    name: "create_artifact",
    args: { kind: "document" },
    result: {},
  };
  const browse = { name: "browser_snapshot", args: {}, result: {} };
  const research = {
    docs: ["x", "linkedin"] as ("x" | "linkedin")[],
    research: true,
  };
  assert.ok(
    !failed(
      gradeWriting(research, {
        status: "completed",
        turns,
        calls: [browse, write],
      }),
    ).length,
  );
  assert.deepEqual(
    failed(
      gradeWriting(research, {
        status: "completed",
        turns,
        calls: [write, browse],
      }),
    ),
    ["Researched in the browser before writing"],
  );
  const image = { file: "users/u/media/img.png" };
  const imageTurns = [
    {
      id: "t1",
      status: "completed",
      artifacts: [
        doc("LinkedIn", `${linkedin} Weekly Founder Digest every Monday.`),
        { kind: "image", content: JSON.stringify(image) },
      ],
    },
  ];
  const generate = {
    name: "media_generate_image",
    args: {},
    result: { attachments: [image] },
  };
  const imagePost = { docs: ["linkedin"] as ("x" | "linkedin")[], image: true };
  assert.deepEqual(
    failed(
      gradeWriting(imagePost, {
        status: "completed",
        turns: imageTurns,
        calls: [generate],
      }),
    ),
    [],
  );
  assert.deepEqual(
    failed(
      gradeWriting(imagePost, {
        status: "completed",
        turns: imageTurns,
        calls: [],
      }),
    ),
    ["Generated image delivered"],
  );
});

test("M1 needs every media tool, and the transcript must match the spoken sentence", () => {
  const call = (
    turn: string,
    name: string,
    args: object = {},
    result: object = {},
  ) => ({
    turn_id: turn,
    name,
    args,
    result,
  });
  const turns = [
    { id: "t1", artifacts: [{ kind: "image" }, { kind: "audio" }] },
    { id: "t2", artifacts: [] },
  ];
  const calls = [
    call("t1", "media_generate_image"),
    call("t1", "media_list_voices", {}, { voices: [{ voice_id: "v1" }] }),
    call("t1", "media_generate_speech", {
      voice_id: "v1",
      text: mediaSentence,
    }),
    call("t1", "media_generate_sound_effect"),
    call("t2", "media_edit_image"),
    call(
      "t2",
      "media_transcribe",
      {},
      { text: "welcome to personal brand agent" },
    ),
  ];
  assert.deepEqual(failed(gradeMediaTools({ turns, calls })), []);
  calls.find((c) => c.name === "media_transcribe")!.result = {
    text: "Welcome to Personal Brand Agency.",
  };
  calls.push(
    call("t2", "media_generate_speech", {
      voice_id: "v1",
      text: mediaSentence,
    }),
  );
  calls[2].args = { voice_id: "made-up", text: mediaSentence };
  assert.deepEqual(failed(gradeMediaTools({ turns, calls })), [
    "Speech uses a voice from media_list_voices",
    "Transcript matches the spoken sentence",
    "Nothing else made again in the revision",
  ]);
});

test("the writing tools check needs the exact edited text, one document and the exact reply", () => {
  const calls = [
    { name: "create_artifact", args: { kind: "document" }, result: {} },
    { name: "read_artifact", args: {}, result: {} },
    { name: "edit_document", args: {}, result: {} },
    { name: "list_my_posts", args: {}, result: {} },
  ];
  const artifacts: any[] = [
    doc("Tool check", "Shipping wins over polishing."),
    { kind: "reply", content: JSON.stringify({ text: "Same here." }) },
  ];
  assert.deepEqual(
    failed(gradeWritingTools({ status: "completed", calls, artifacts })),
    [],
  );
  artifacts.push(doc("Tool check (edited)", "Shipping wins over polishing."));
  artifacts[0].content = "Shipping beats polishing.";
  assert.deepEqual(
    failed(gradeWritingTools({ status: "completed", calls, artifacts })),
    ["Edited in place to the exact text", "Only one Tool check document"],
  );
});

test("the browser tools check needs every tool, delivered images and every tab closed", () => {
  const shot = {
    kind: "screenshot",
    file: "users/u/screenshots/s.jpg",
    mime_type: "image/jpeg",
  };
  const image = {
    file: "users/u/downloads/bangkok.jpg",
    mime_type: "image/jpeg",
  };
  const calls: any[] = [
    { name: "browser_open", args: {}, result: { tab: "t1" } },
    { name: "browser_snapshot", args: { tab: "t1" }, result: {} },
    { name: "browser_type", args: { text: "Grand Palace" }, result: {} },
    { name: "browser_scroll", args: {}, result: {} },
    { name: "browser_click", args: {}, result: {} },
    { name: "browser_screenshot", args: {}, result: { attachments: [shot] } },
    { name: "browser_fetch_file", args: {}, result: { attachments: [image] } },
    { name: "browser_close", args: { tab: "t1" }, result: {} },
  ];
  const artifacts = [shot, image].map((a) => ({
    kind: "image",
    content: JSON.stringify({ file: a.file }),
  }));
  const grade = (c: any[]) =>
    failed(
      gradeBrowserTools({
        status: "completed",
        calls: c,
        artifacts,
        final: "Bangkok - Wikipedia",
      }),
    );
  assert.deepEqual(grade(calls), []);
  assert.deepEqual(
    grade(
      calls.filter(
        (c) => !["browser_close", "browser_fetch_file"].includes(c.name),
      ),
    ),
    ["Image file fetched and delivered", "Closed every tab it opened"],
  );
});

test("the quote card needs a square and a portrait image, each delivered, however the portrait is made", () => {
  const square = {
    name: "media_generate_image",
    args: {},
    result: { ref: "sq1", attachments: [{ file: "users/u/media/sq.png" }] },
  };
  const edited = {
    name: "media_edit_image",
    args: { file: "sq1", size: "1024x1536" },
    result: { ref: "pt1", attachments: [{ file: "users/u/media/pt.png" }] },
  };
  const artifacts = ["sq", "pt"].map((n) => ({
    kind: "image",
    content: JSON.stringify({ file: `users/u/media/${n}.png` }),
  }));
  assert.deepEqual(
    failed(gradeQuoteCard({ calls: [square, edited], artifacts })),
    [],
  );
  // A fresh portrait generation of the same design is just as valid.
  const fresh = {
    ...edited,
    name: "media_generate_image",
    args: { size: "1024x1536" },
  };
  assert.deepEqual(
    failed(gradeQuoteCard({ calls: [square, fresh], artifacts })),
    [],
  );
  // A second square is not a portrait, and an undelivered portrait fails delivery only.
  const anotherSquare = { ...fresh, args: { size: "1024x1024" } };
  assert.deepEqual(
    failed(gradeQuoteCard({ calls: [square, anotherSquare], artifacts })),
    ["Portrait version made", "Portrait image delivered"],
  );
  assert.deepEqual(
    failed(
      gradeQuoteCard({
        calls: [square, fresh],
        artifacts: artifacts.slice(0, 1),
      }),
    ),
    ["Portrait image delivered"],
  );
});

test("the voiceover must be transcribed after its final recording and keep every fact", () => {
  const voices = {
    name: "media_list_voices",
    args: {},
    result: { voices: [{ voice_id: "v1" }] },
  };
  const speak = (ref: string) => ({
    name: "media_generate_speech",
    args: { voice_id: "v1", text: "..." },
    result: { ref, attachments: [{ file: `users/u/media/${ref}.mp3` }] },
  });
  const transcribe = (file: string, text: string) => ({
    name: "media_transcribe",
    args: { file },
    result: { text },
  });
  const good =
    "Last month we went from 120 to 310 weekly founders. Join our live AMA on Friday at 7 PM Bangkok time. Sign up at lu dot ma slash autopilot AMA.";
  const artifacts = [
    {
      kind: "audio",
      content: JSON.stringify({ file: "users/u/media/s2.mp3" }),
    },
  ];
  const fixed = [
    voices,
    speak("s1"),
    transcribe("s1", "... lou mah ..."),
    speak("s2"),
    transcribe("s2", good),
  ];
  assert.deepEqual(failed(gradeVoiceover({ calls: fixed, artifacts })), []);
  // The transcriber's own formatting still counts: "7:00 PM" and a run-together link.
  const formatted =
    "Last month, we went from 120 to 310 weekly founders. Join our live AMA on Friday at 7:00 PM Bangkok time. Sign up at alu.ma/autopilotama";
  assert.deepEqual(
    failed(
      gradeVoiceover({
        calls: [voices, speak("s2"), transcribe("s2", formatted)],
        artifacts,
      }),
    ),
    [],
  );
  // A skipped fact still fails.
  assert.deepEqual(
    failed(
      gradeVoiceover({
        calls: [
          voices,
          speak("s2"),
          transcribe("s2", formatted.replace(" Bangkok", "")),
        ],
        artifacts,
      }),
    ),
    ["Transcript keeps every fact in the script"],
  );
  // Checking only the first take, then delivering an unchecked second one, does not count.
  const unchecked = [voices, speak("s1"), transcribe("s1", good), speak("s2")];
  assert.deepEqual(failed(gradeVoiceover({ calls: unchecked, artifacts })), [
    "Final recording transcribed before delivery",
    "Transcript keeps every fact in the script",
  ]);
});

test("idea routines need their skill, the right number of ideas, and the work read for work ideas", () => {
  const idea = { kind: "idea", title: "Idea", content: "..." };
  const work = ideasCases.find((c) => c.id === "work-ideas")!;
  const calls = [
    { name: "read_skill", args: { name: "work-content-ideas" }, result: {} },
    { name: "git_activity", args: { path: "streaks" }, result: {} },
  ];
  const grade = (c: any[], artifacts: any[]) =>
    failed(gradeIdeas(work, { status: "completed", calls: c, artifacts }));
  assert.deepEqual(grade(calls, [idea, idea]), []);
  assert.deepEqual(grade(calls.slice(0, 1), [idea, idea, idea, idea]), [
    "1–3 idea artifacts",
    "Read the recent work in the project's git history",
  ]);
  const strategy = ideasCases.find((c) => c.id === "weekly-strategy")!;
  const read = [
    {
      name: "read_skill",
      args: { name: "weekly-strategy-research" },
      result: {},
    },
  ];
  assert.deepEqual(
    failed(
      gradeIdeas(strategy, {
        status: "completed",
        calls: read,
        artifacts: [{ kind: "document", title: "Strategy — X — 2026-10-29" }],
      }),
    ),
    [],
  );
});

test("format checks measure the post, not the Other openings and Placeholders notes after it", () => {
  const notes =
    "\n\n---\n**Other openings:**\n1. " +
    "a".repeat(200) +
    "\n2. b\n\n**Placeholders:**\nNone.";
  const post = "Removed one step. Onboarding 9 → 4 min, completion 41% → 63%.";
  assert.equal(postBody(post + notes), post);
  assert.equal(postBody(post + "\n\n**Other openings:**\n1. x"), post);
  assert.equal(postBody(post), post);
  const turns = [
    {
      id: "t1",
      status: "completed",
      artifacts: [doc("X", post + notes), doc("LinkedIn", linkedin + notes)],
    },
  ];
  assert.deepEqual(
    failed(
      gradeWriting(expect("post-in-voice"), {
        status: "completed",
        turns,
        calls: [],
      }),
    ),
    [],
  );
  // A placeholder or a long post still fails when it is in the post itself.
  turns[0].artifacts[0] = doc(
    "X",
    `${"x".repeat(290)} 9 4 41% 63% [your metric]${notes}`,
  );
  assert.deepEqual(
    failed(
      gradeWriting(expect("post-in-voice"), {
        status: "completed",
        turns,
        calls: [],
      }),
    ),
    ["X posts within 280 characters", "No placeholders left"],
  );
});

test("a LinkedIn post may be as short as the founder's own, but not over 250 words", () => {
  const short =
    "Cut onboarding from 9 minutes to 4. Finish rate 41% → 63%. One step gone.";
  const grade = (linkedinText: string) =>
    failed(
      gradeWriting(expect("post-in-voice"), {
        status: "completed",
        turns: [
          {
            id: "t1",
            status: "completed",
            artifacts: [doc("X", short), doc("LinkedIn", linkedinText)],
          },
        ],
        calls: [],
      }),
    );
  assert.deepEqual(grade(short), []);
  assert.deepEqual(grade(`${short} ${"word ".repeat(250)}`), [
    "LinkedIn post 1–250 words",
  ]);
});

test("commit to ideas only proposes, leading with the demo-worthy work", () => {
  const tide = ideasCases.find((c) => c.id === "tide-from-commits")!;
  const calls = [
    { name: "read_skill", args: { name: "work-content-ideas" }, result: {} },
    { name: "git_activity", args: { path: "tide" }, result: {} },
  ];
  const idea = (title: string, content = "**Demo plan**: steps") => ({
    kind: "idea",
    title,
    content,
  });
  const failed = (c: any[], artifacts: any[]) =>
    gradeIdeas(tide, { status: "completed", calls: c, artifacts })
      .filter((check) => !check.passed)
      .map((check) => check.name);
  assert.deepEqual(failed(calls, [idea("Quick add in one sentence")]), []);
  const leads =
    "The strongest idea, first, has a demo plan for the demo-worthy work";
  assert.deepEqual(
    failed(calls, [
      idea("The date picker", "One sentence box. **Demo plan**: steps"),
    ]),
    [],
  );
  assert.deepEqual(failed(calls, [idea("Two tabs lost my edits")]), [leads]);
  assert.deepEqual(failed(calls, [idea("Quick add", "A text post")]), [leads]);
  assert.deepEqual(
    failed(
      [...calls, { name: "browser_open", args: {}, result: {} }],
      [idea("Quick add")],
    ),
    ["Only proposed: no browsing, recording or video"],
  );
});

test("an editing eval needs the founder's recordings edited, not re-recorded", async () => {
  const { editCases, gradeEdit } = await import("../src/evals/edit-cases.js");
  const entry = editCases[0];
  const upload = (clip: string, ref: string) => ({
    name: "upload_file",
    args: { path: `eval-fixtures/ledgerly-recordings/${clip}` },
    result: { ref, file: `users/u/media/${ref}abcd.mp4` },
  });
  const calls: any[] = [
    ...entry.clips.map((clip, i) => upload(clip, `r${i}000000`)),
    upload("music.mp3", "m0000000"),
    {
      name: "video_export",
      args: {
        voiceover_file: "v1",
        music: { file: "m0000000" },
        scenes: entry.clips.map((_, i) => ({ video_file: `r${i}000000` })),
      },
      result: { ref: "out" },
    },
  ];
  const failed = (cs: any[]) =>
    gradeEdit(entry, { status: "completed", calls: cs, artifacts: [] })
      .filter((c) => !c.passed)
      .map((c) => c.name);
  assert.deepEqual(failed(calls), []);
  assert.deepEqual(failed([...calls, { name: "screen_record_start", args: {}, result: {} }]), [
    "Edited, not re-recorded",
  ]);
  assert.deepEqual(failed([...calls, { name: "browser_open", args: {}, result: {} }]), []);
  assert.ok(failed(calls.slice(1)).includes("Brought in the founder's recordings"));
  // Reading the track in (to listen to its length) brings it in too.
  const read = { ...upload("music.mp3", "m0000000"), name: "read_file" };
  assert.deepEqual(failed(calls.map((c) => (c.args.path?.endsWith("music.mp3") ? read : c))), []);
  assert.deepEqual(failed(calls.filter((c) => !c.args.path?.endsWith("music.mp3"))), [
    "Used the founder's track under the voice",
  ]);
});

test("an editing eval with mistakes in the take checks they were cut", async () => {
  const { editCases, gradeEdit } = await import("../src/evals/edit-cases.js");
  const entry = editCases.find((c) => c.id === "edit-ledgerly-one-take")!;
  const calls = (scenes: any[]): any[] => [
    {
      name: "upload_file",
      args: { path: "eval-fixtures/ledgerly-take-recordings/ledgerly-take.mp4" },
      result: { ref: "t0000000", file: "users/u/media/t0000000abcd.mp4" },
    },
    { name: "read_file", args: { path: "eval-fixtures/ledgerly-take-recordings/music.mp3" }, result: { ref: "m0000000" } },
    {
      name: "video_export",
      args: { voiceover_file: "v1", music: { file: "m0000000" }, scenes },
      result: { ref: "out" },
    },
  ];
  const failed = (scenes: any[]) =>
    gradeEdit(entry, { status: "completed", calls: calls(scenes), artifacts: [] })
      .filter((c) => !c.passed)
      .map((c) => c.name);
  const clean = [
    { video_file: "t0000000", start_seconds: 1, end_seconds: 6 },
    { video_file: "t0000000", start_seconds: 12.5, end_seconds: 17 },
    { video_file: "t0000000", start_seconds: 19, end_seconds: 30 },
    { video_file: "t0000000", start_seconds: 35 },
  ];
  assert.deepEqual(failed(clean), []);
  // Playing on from the dashboard into Clients, or through the typo, fails.
  assert.deepEqual(failed([{ video_file: "t0000000", start_seconds: 1 }, ...clean.slice(3)]), [
    "Cut the wrong turn into Clients",
    'Cut the typo "Webiste"',
  ]);
  assert.deepEqual(failed([{ video_file: "t0000000", start_seconds: 14, end_seconds: 20 }]), ['Cut the typo "Webiste"']);
  // A scene with no end plays for as long as it lasts in the export.
  const timed = (scenes: any[], starts: number[], seconds: number) => {
    const all = calls(scenes);
    all[2].result = { ref: "out", scene_starts: starts.map((at_seconds) => ({ at_seconds })), duration_seconds: seconds };
    return gradeEdit(entry, { status: "completed", calls: all, artifacts: [] })
      .filter((c) => !c.passed)
      .map((c) => c.name);
  };
  const opening = [{ video_file: "t0000000", start_seconds: 0.5 }, { video_file: "t0000000", start_seconds: 35 }];
  assert.deepEqual(timed(opening, [0, 4], 10), []);
  assert.deepEqual(timed(opening, [0, 9], 15), ["Cut the wrong turn into Clients"]);
});
