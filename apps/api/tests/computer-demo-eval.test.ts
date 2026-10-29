import { test } from "node:test";
import assert from "node:assert/strict";
import { demoCases, gradeDemoCapture } from "../src/evals/computer-demo-cases.js";

const demo = (id: string) => demoCases.find((c) => c.id === id)!;
const clip = (n: number) => ({
  file: `users/u/media/clip${n}aaaaaaaa.mp4`,
  ref: `clip${n}`,
  mime_type: "video/mp4",
});
function recorded(texts: string[][]) {
  const calls: any[] = [
    {
      name: "computer_open",
      args: { app_id: "/System/Applications/Maps.app" },
      result: { apps: [{ name: "Maps", path: "/System/Applications/Maps.app" }] },
    },
    { name: "screen_capture", args: {}, result: { attachments: [] } },
  ];
  texts.forEach((typed, i) => {
    calls.push({ name: "screen_record_start", args: {}, result: { id: `r${i}` } });
    for (const text of typed)
      calls.push({ name: "computer_type", args: { text }, result: { input_sent: true } });
    calls.push({
      name: "screen_record_stop",
      args: { id: `r${i}` },
      result: { duration_seconds: 6, stopped_by: "tool", attachments: [clip(i)] },
    });
  });
  return calls;
}
const failed = (checks: { name: string; passed: boolean }[]) =>
  checks.filter((c) => !c.passed).map((c) => c.name);

test("a level 2 demo passes on recorded, on-camera work delivered as clips", () => {
  const entry = demo("demo-mac-maps-route");
  const calls = recorded([["Siam Paragon"], ["Grand Palace"]]);
  const artifacts = [0, 1].map((n) => ({
    kind: "video",
    content: JSON.stringify({ file: clip(n).file }),
  }));
  assert.deepEqual(failed(gradeDemoCapture(entry, { status: "completed", calls, artifacts })), []);
  // Typing outside a recording, or clips that were never delivered, do not count.
  const offCamera = recorded([[], []]);
  offCamera.push({ name: "computer_type", args: { text: "Grand Palace" }, result: { input_sent: true } });
  assert.deepEqual(failed(gradeDemoCapture(entry, { status: "completed", calls: offCamera, artifacts })), [
    "Used the app while recording",
    'Typed "Grand Palace" on camera',
    'Typed "Siam Paragon" on camera',
  ]);
  assert.deepEqual(failed(gradeDemoCapture(entry, { status: "completed", calls, artifacts: [] })), [
    "Clips delivered as video artifacts",
  ]);
});

test("a level 3 demo needs a narrated export built from the recorded clips", () => {
  const entry = { ...demo("demo-mac-maps-route"), level: 3 as const, video: { seconds: [15, 30] as [number, number] } };
  const calls = recorded([["Siam Paragon"], ["Grand Palace"]]);
  const exportCall = (scenes: object[], voiceover_file?: string) => ({
    name: "video_export",
    args: { scenes, voiceover_file },
    result: { attachments: [{ file: "users/u/media/final.mp4", mime_type: "video/mp4" }] },
  });
  const fromClips = [{ video_file: "clip0" }, { video_file: "clip1" }];
  assert.deepEqual(
    failed(gradeDemoCapture(entry, { status: "completed", calls: [...calls, exportCall(fromClips, "voice")], artifacts: [] })),
    [],
  );
  assert.deepEqual(
    failed(gradeDemoCapture(entry, {
      status: "completed",
      calls: [...calls, exportCall([{ image_file: "still1" }, { image_file: "still2" }])],
      artifacts: [],
    })),
    ["Video built from the recorded clips", "Video narrated"],
  );
});

test("a recording stopped by the founder or never looked at first does not count", () => {
  const entry = demo("demo-sim-maps-place");
  const calls = recorded([["Bangkok"]]).filter((c) => c.name !== "screen_capture");
  calls.find((c) => c.name === "screen_record_stop").result.stopped_by = "founder";
  assert.deepEqual(failed(gradeDemoCapture(entry, { status: "completed", calls, artifacts: [] })), [
    "Opened the app being demonstrated",
    "Looked at the screen before recording",
    "Recorded at least 1 clip(s)",
    "Clips delivered as video artifacts",
  ]);
});

test("a demo from the founder's work needs the git history read and the local app opened", () => {
  const entry = demo("demo-work-video");
  const calls: any[] = [
    { name: "git_activity", args: { path: "streaks" }, result: {} },
    { name: "browser_open", args: { url: "http://127.0.0.1:4110/" }, result: { tab: "t1" } },
    ...recorded([[], []]).slice(1),
  ];
  calls.splice(4, 0, { name: "computer_click", args: {}, result: { input_sent: true } });
  calls.splice(8, 0, { name: "computer_click", args: {}, result: { input_sent: true } });
  calls.push({
    name: "video_export",
    args: { scenes: [{ video_file: "clip0" }, { video_file: "clip1" }], voiceover_file: "voice" },
    result: {},
  });
  assert.deepEqual(failed(gradeDemoCapture(entry, { status: "completed", calls, artifacts: [] })), []);
  assert.deepEqual(failed(gradeDemoCapture(entry, { status: "completed", calls: calls.slice(1), artifacts: [] })), [
    "Read the recent work in the project's git history",
  ]);
});
