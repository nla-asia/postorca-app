import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeWriting, writingCases } from "../src/evals/writing-cases.js";
import { gradeMediaTools, mediaSentence } from "../src/evals/media-cases.js";

const expect = (id: string) => writingCases.find((c) => c.id === id)!.expect;
const failed = (checks: { name: string; passed: boolean }[]) =>
  checks.filter((c) => !c.passed).map((c) => c.name);
const linkedin =
  "Last week we cut onboarding from 9 minutes to 4. " +
  "We removed one step. ".repeat(25) +
  "Completion went from 41% to 63%.";
const doc = (title: string, content: string) => ({ kind: "document", title, content });

test("writing checks platform format and supplied facts", () => {
  const turns = [
    {
      id: "t1",
      status: "completed",
      artifacts: [
        doc("X", "Cut onboarding from 9 min to 4. Completion: 41% → 63%. #buildinpublic"),
        doc("LinkedIn", linkedin),
      ],
    },
  ];
  assert.deepEqual(failed(gradeWriting(expect("post-in-voice"), { status: "completed", turns, calls: [] })), []);
  turns[0].artifacts = [
    doc("X post", `1/ ${"a".repeat(300)}\n\n2/ Completion went from 41% to 63%.`),
    doc("LinkedIn", `${linkedin} #startups [your metric]`),
  ];
  assert.deepEqual(failed(gradeWriting(expect("post-in-voice"), { status: "completed", turns, calls: [] })), [
    "X posts within 280 characters",
    "No hashtags on LinkedIn",
    "Keeps the supplied fact /\\b(9|nine)\\b/",
    "Keeps the supplied fact /\\b(4|four)\\b/",
    "No placeholders left",
  ]);
});

test("a revision must edit the existing document and meet the new length", () => {
  const short = "Last week we cut onboarding from 9 minutes to 4, and completion went from 41% to 63%.";
  const turns = [
    { id: "t1", status: "completed", artifacts: [doc("LinkedIn", short)] },
    { id: "t2", status: "completed", artifacts: [] },
  ];
  const edit = { name: "edit_document", turn_id: "t2", args: { id: "a1" }, result: {} };
  const create = { name: "create_artifact", turn_id: "t2", args: { kind: "document" }, result: {} };
  const grade = (calls: any[]) =>
    failed(gradeWriting(expect("revise-from-feedback"), { status: "completed", turns, calls }));
  assert.deepEqual(grade([edit]), []);
  assert.deepEqual(grade([create]), ["Revised the existing document in place"]);
});

test("research must come before writing; image posts need a generated image", () => {
  const turns = [{ id: "t1", status: "completed", artifacts: [doc("X", "take"), doc("LinkedIn", linkedin)] }];
  const write = { name: "create_artifact", args: { kind: "document" }, result: {} };
  const browse = { name: "browser_snapshot", args: {}, result: {} };
  const research = expect("research-to-post");
  assert.ok(!failed(gradeWriting(research, { status: "completed", turns, calls: [browse, write] })).length);
  assert.deepEqual(failed(gradeWriting(research, { status: "completed", turns, calls: [write, browse] })), [
    "Researched in the browser before writing",
  ]);
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
  const generate = { name: "media_generate_image", args: {}, result: { attachments: [image] } };
  assert.deepEqual(failed(gradeWriting(expect("image-post"), { status: "completed", turns: imageTurns, calls: [generate] })), []);
  assert.deepEqual(failed(gradeWriting(expect("image-post"), { status: "completed", turns: imageTurns, calls: [] })), [
    "Generated image delivered",
  ]);
});

test("M1 needs every media tool, and the transcript must match the spoken sentence", () => {
  const call = (turn: string, name: string, args: object = {}, result: object = {}) => ({
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
    call("t1", "media_generate_speech", { voice_id: "v1", text: mediaSentence }),
    call("t1", "media_generate_music"),
    call("t1", "media_generate_sound_effect"),
    call("t2", "media_edit_image"),
    call("t2", "media_transcribe", {}, { text: "welcome to personal brand agent" }),
  ];
  assert.deepEqual(failed(gradeMediaTools({ turns, calls })), []);
  calls[6].result = { text: "Welcome to Personal Brand Agency." };
  calls.push(call("t2", "media_generate_speech", { voice_id: "v1", text: mediaSentence }));
  calls[2].args = { voice_id: "made-up", text: mediaSentence };
  assert.deepEqual(failed(gradeMediaTools({ turns, calls })), [
    "Speech uses a voice from media_list_voices",
    "Transcript matches the spoken sentence",
    "Nothing else made again in the revision",
  ]);
});
