import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeVideo,
  toolEvidence,
  type EvalMessage,
} from "../src/evals/video-grade.js";
import { videoCases } from "../src/evals/video-cases.js";

function call(
  name: string,
  args: object,
  result: object = {},
  callId = name,
): EvalMessage[] {
  return [
    {
      kind: "tool_call",
      content: { name, callId, arguments: JSON.stringify(args) },
    },
    { kind: "tool_result", content: { callId, result } },
  ];
}
const video =
  "users/00000000-0000-0000-0000-000000000000/media/11111111-1111-1111-1111-111111111111.mp4";
const artifact = {
  id: "artifact",
  kind: "video",
  content: JSON.stringify({ file: video }),
};
const scenes = [
  { image_file: "12345678", text: "120 → 310", duration_seconds: 2 },
  { image_file: "87654321", text: "9 minutes → 4", duration_seconds: 2 },
];
const b5 = videoCases.find((entry) => entry.id === "B5")!;

test("video eval retains original scenarios, exact numbers, follow-ups and feature limits", () => {
  assert.equal(videoCases.length, 20);
  assert.deepEqual(b5.expect.mustInclude, [
    "\\b120\\b",
    "\\b310\\b",
    "\\b(9|nine)\\b",
    "\\b(4|four)\\b",
  ]);
  assert.deepEqual(
    videoCases.find((entry) => entry.id === "B7")!.expect.exports,
    [1, 2],
  );
  assert.deepEqual(
    videoCases.find((entry) => entry.id === "F7")!.expect.seconds,
    [55, 90],
  );
});

test("a successful export alone cannot pass artifact delivery or preview checks", () => {
  const result = gradeVideo(
    b5,
    call(
      "video_export",
      { scenes },
      { attachments: [{ file: video, mime_type: "video/mp4" }] },
    ),
    [],
    1,
  );
  assert.equal(
    result.checks.find((check) => check.name === "Exported the expected MP4s")!
      .ok,
    true,
  );
  assert.equal(
    result.checks.find(
      (check) => check.name === "Exported files delivered as video artifacts",
    )!.ok,
    false,
  );
  assert.equal(
    result.checks.find((check) => check.name.includes("previewed"))!.ok,
    false,
  );
});

test("graded video uses successful tool results, exact supplied figures and persistent artifact refs", () => {
  const messages = [
    ...call("read_skill", { name: "video-build-log" }),
    ...call("media_generate_image", { prompt: "Candid smartphone photograph" }),
    ...call("video_preview_frames", { scenes }),
    ...call(
      "video_export",
      { scenes, voiceover_file: "voice" },
      { attachments: [{ file: video, mime_type: "video/mp4" }] },
    ),
  ];
  const result = gradeVideo(b5, messages, [artifact], 1);
  assert.deepEqual(
    result.checks.filter((check) => check.ok === false),
    [],
  );
  assert.ok(result.checks.some((check) => check.ok === null));
  assert.equal(result.usage.video_export, 1);
  assert.equal(result.files[0], video);
});

test("image style ignores rejected work without hiding errors or actual non-candid images", () => {
  for (const [prompt, expected] of [
    ["Candid smartphone photograph", true],
    ["Polished studio illustration", false],
  ] as const) {
    const messages = [
      ...call(
        "media_generate_image",
        { prompt: "Narration script", voice_id: "voice" },
        { error: "Invalid arguments: unrecognized voice_id" },
        "rejected",
      ),
      ...call("media_generate_image", { prompt }, {}, "created"),
      ...call(
        "media_generate_image",
        { prompt: "Candid phone photograph" },
        {},
        "another-created",
      ),
    ];
    const result = gradeVideo(b5, messages, [], 1);
    assert.equal(
      result.checks.find(
        (check) => check.name === "Requested candid phone-style images",
      )!.ok,
      expected,
    );
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Invalid arguments/);
    assert.equal(result.usage.media_generate_image, 3);
  }
});

test("paid retries are detected even when skill reads separate the failed and repeated calls", () => {
  const messages = [
    ...call(
      "media_generate_speech",
      { text: "Script" },
      { error: "Media provider request failed (HTTP 401, quota_exceeded)" },
      "failed",
    ),
    ...call("read_skill", { name: "video-create" }),
    ...call("media_generate_speech", { text: "Script" }, {}, "retried"),
  ];
  const result = gradeVideo(b5, messages, [], 1);
  assert.equal(
    result.checks.find(
      (check) => check.name === "No paid retry after a failure",
    )!.ok,
    false,
  );
  assert.equal(result.errors.length, 1);
});

test("correcting locally rejected arguments is not counted as a repeated paid request", () => {
  const messages = [
    ...call(
      "video_export",
      {},
      { error: "File not found: bad ref" },
      "rejected",
    ),
    ...call(
      "video_export",
      { scenes },
      { attachments: [{ file: video, mime_type: "video/mp4" }] },
      "corrected",
    ),
  ];
  assert.equal(
    gradeVideo(b5, messages, [artifact], 1).checks.find(
      (check) => check.name === "No paid retry after a failure",
    )!.ok,
    true,
  );
});

test("captions and colour overrides are checked against their specific feature brief", () => {
  const entry = videoCases.find((item) => item.id === "F2")!;
  const messages = [
    ...call("video_preview_frames", { scenes }),
    ...call(
      "video_export",
      { scenes, voiceover_file: "voice", captions: true },
      { attachments: [{ file: video, mime_type: "video/mp4" }] },
    ),
  ];
  assert.equal(
    gradeVideo(entry, messages, [artifact], 1).checks.find(
      (check) => check.name === "Captions disabled as requested",
    )!.ok,
    false,
  );
  const f5 = videoCases.find((item) => item.id === "F5")!;
  assert.equal(
    gradeVideo(f5, messages, [artifact], 1).checks.find(
      (check) => check.name === "Overrode colours as requested",
    )!.ok,
    false,
  );
});

test("consecutive scenes on one image are one shot for pacing", () => {
  const messages = call(
    "video_export",
    {
      scenes: [
        { image_file: "same", text: "Hook", duration_seconds: 2 },
        { image_file: "same", text: "Still same shot", duration_seconds: 2 },
      ],
    },
    { attachments: [{ file: video, mime_type: "video/mp4" }] },
  );
  const result = gradeVideo(b5, messages, [artifact], 1);
  assert.equal(
    result.checks.find((check) => check.name.includes("cuts every"))!.ok,
    false,
  );
});

test("missing or malformed tool results do not become successful evidence", () => {
  const evidence = toolEvidence([
    {
      kind: "tool_call",
      content: { callId: "bad", name: "video_export", arguments: "{" },
    },
  ]);
  assert.equal(evidence[0].failed, true);
  assert.deepEqual(evidence[0].args, {});
});
