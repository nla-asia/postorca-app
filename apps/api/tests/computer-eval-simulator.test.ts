import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simulatorCase,
  gradeSimulator,
} from "../src/evals/computer-mac-simulator.js";
import type { EvalEvidence, EvalCall } from "../src/evals/computer-eval-types.js";
function fixture() {
  const app = {
    id: "/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app",
    path: "/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app",
    name: "Simulator",
    running: true,
    windows: [{ id: "sim" }],
  };
  const shot = (observation: string) => ({
    window: "sim",
    observation,
    attachments: [{ kind: "screenshot", file: "result.png" }],
  });
  const input = (args: any, result: any = {}): EvalCall => ({
    name: "computer_click",
    args: { window: "sim", ...args },
    result: { input_sent: true, window: "sim", ...result },
  });
  const evidence: EvalEvidence = {
    status: "completed",
    final: "Bangkok",
    controlReleased: true,
    artifacts: [
      { kind: "image", content: JSON.stringify({ file: "result.png" }) },
    ],
    calls: [
      {
        name: "desktop_status",
        args: {},
        result: { plugins: { computer: { platform: "darwin" } } },
      },
      { name: "activate_plugin", args: { code: "computer" }, result: {} },
      { name: "read_skill", args: { name: "computer-use" }, result: {} },
      { name: "computer_list_apps", args: {}, result: { apps: [app] } },
      {
        name: "computer_open",
        args: { app_id: app.id },
        result: { apps: [app] },
      },
      { name: "computer_observe", args: { window: "sim" }, result: shot("o1") },
      input({ observation: "o1", menu_path: ["File", "Record Screen"] }),
      { name: "computer_observe", args: { window: "sim" }, result: shot("o2") },
      {
        name: "computer_type",
        args: { window: "sim", observation: "o2", text: "Bangkok" },
        result: { ...shot("o3"), input_sent: true },
      },
      input({ observation: "o3", menu_path: ["File", "Stop Recording"] }),
      { name: "computer_observe", args: { window: "sim" }, result: shot("o4") },
      input({ observation: "o4", menu_path: ["Simulator", "Quit Simulator"] }),
    ],
    observed: {
      coldFixture: true,
      simulatorRunning: false,
      apps: [{ ...app, running: false, windows: [] }],
      recordings: [
        {
          size: 1000,
          duration_seconds: 10,
          width: 100,
          height: 200,
          retained: "recording.mov",
        },
      ],
    },
  };
  const entry = simulatorCase("mac-simulator-maps", "test");
  return { evidence, checks: () => gradeSimulator(entry, evidence) };
}
test("Simulator case is manual-review Mac eval and requires exact native menu sequence", () => {
  const f = fixture();
  assert.ok(simulatorCase("mac-simulator-maps", "test").manualReview);
  assert.ok(
    f.checks().every((c) => c.passed),
    JSON.stringify(f.checks()),
  );
  f.evidence.calls[6].args.menu_path = undefined;
  f.evidence.calls[6].name = "computer_press";
  f.evidence.calls[6].args.key = "r";
  assert.equal(
    f
      .checks()
      .find((c) => c.name === "File menu recording surrounds Bangkok search")
      ?.passed,
    false,
  );
});
test("Simulator cannot pass with an old/empty clip, a warm fixture, stale input, or an app left running", () => {
  for (const mutate of [
    (e: EvalEvidence) => {
      e.observed.recordings = [];
    },
    (e: EvalEvidence) => {
      e.observed.recordings[0].duration_seconds = 0;
    },
    (e: EvalEvidence) => {
      e.observed.coldFixture = false;
    },
    (e: EvalEvidence) => {
      e.observed.simulatorRunning = true;
    },
    (e: EvalEvidence) => {
      e.calls[8].args.observation = "stale";
    },
    (e: EvalEvidence) => {
      e.calls.push({ name: "screen_record_start", args: {}, result: {} });
    },
  ]) {
    const f = fixture();
    mutate(f.evidence);
    assert.ok(f.checks().some((c) => !c.passed));
  }
});

test("Simulator launch may return before a window exists; later discovery and input establish readiness", () => {
  const f = fixture();
  f.evidence.calls[4].result = {
    apps: [],
    note: "Launch requested; completion unverified",
  };
  assert.ok(
    f.checks().every((c) => c.passed),
    JSON.stringify(f.checks()),
  );
  f.evidence.calls[4].args.app_id = "/Applications/Other.app";
  assert.equal(
    f
      .checks()
      .find(
        (c) => c.name === "Simulator discovered and opened from cold fixture",
      )?.passed,
    false,
  );
});

test("Simulator rejects other app input and old recording claims", () => {
  const f = fixture();
  const finder = {
    id: "/System/Library/CoreServices/Finder.app",
    path: "/System/Library/CoreServices/Finder.app",
    name: "Finder",
    windows: [{ id: "finder" }],
  };
  f.evidence.calls.splice(
    10,
    0,
    {
      name: "computer_open",
      args: { app_id: finder.id },
      result: { apps: [finder] },
    },
    {
      name: "computer_observe",
      args: { window: "finder" },
      result: {
        window: "finder",
        observation: "finder-shot",
        attachments: [{ kind: "screenshot", file: "finder.png" }],
      },
    },
    {
      name: "computer_click",
      args: {
        window: "finder",
        observation: "finder-shot",
        menu_path: ["Go", "Desktop"],
      },
      result: { window: "finder", input_sent: true },
    },
  );
  assert.equal(
    f
      .checks()
      .find((c) => c.name === "Input confined to observed Simulator windows")
      ?.passed,
    false,
  );
  f.evidence.calls[12].args.menu_path = ["File", "Move to Trash"];
  assert.equal(
    f
      .checks()
      .find((c) => c.name === "Input confined to observed Simulator windows")
      ?.passed,
    false,
  );
  f.evidence.final = "Saved Simulator Screen Recording - old.mov";
  f.evidence.observed.recordings[0].source =
    "/Desktop/Simulator Screen Recording - new.mov";
  assert.equal(
    f
      .checks()
      .find((c) => c.name === "Claimed recording filename matches this run")
      ?.passed,
    false,
  );
  f.evidence.final = "Saved Simulator Screen Recording - new.mov";
  assert.equal(
    f
      .checks()
      .find((c) => c.name === "Claimed recording filename matches this run")
      ?.passed,
    true,
  );
});
