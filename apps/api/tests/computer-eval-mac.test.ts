import { test } from "node:test";
import assert from "node:assert/strict";
import {
  macComputerCase,
  gradeMacComputer,
  macCalculatorPath,
} from "../src/evals/computer-mac-cases.js";
import {
  macExecutionFingerprint,
  macPassingStreak,
  type MacGateRun,
} from "../src/evals/computer-mac-gates.js";
import type { EvalEvidence } from "../src/evals/computer-eval-types.js";

function fixture() {
  const entry = macComputerCase("mac-calculator", 1, "test");
  const app = {
    id: macCalculatorPath,
    path: macCalculatorPath,
    windows: [{ id: "mac-window" }],
  };
  const shot = {
    window: "mac-window",
    title: "Calculator",
    observation: "o1_abcdef",
    attachments: [{ kind: "screenshot", file: "current.png" }],
  };
  const evidence: EvalEvidence = {
    status: "completed",
    final: `The result is ${entry.expected.result}.`,
    controlReleased: true,
    artifacts: [
      { kind: "image", content: JSON.stringify({ file: "current.png" }) },
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
        args: { app_id: macCalculatorPath },
        result: { apps: [app] },
      },
      {
        name: "computer_observe",
        args: { window: "mac-window" },
        result: shot,
      },
      {
        name: "computer_press",
        args: {
          window: "mac-window",
          observation: shot.observation,
          key: "enter",
        },
        result: { ...shot, observation: "o2_abcdef", input_sent: true },
      },
    ],
    observed: {
      ...shot,
      app,
      accessibility: {
        source: "macOS Accessibility",
        truncated: false,
        nodes: [
          { role: "AXStaticText", text: `\u200e${entry.expected.result}` },
        ],
      },
    },
  };
  const checks = () => gradeMacComputer(entry, evidence);
  const passed = (name: string) =>
    checks().find((check) => check.name === name)?.passed;
  return { entry, evidence, checks, passed };
}

test("Mac Calculator accepts native AX display evidence and a screenshot from the run", () => {
  const f = fixture();
  assert.ok(
    f.checks().every((check) => check.passed),
    JSON.stringify(f.checks()),
  );
  const entry = macComputerCase("mac-calculator", 3, "test");
  f.evidence.observed.accessibility.nodes[0].text = "\u200e1,389";
  f.evidence.final = "1,389";
  assert.ok(gradeMacComputer(entry, f.evidence).every((check) => check.passed));
});

test("Mac grading rejects Windows display text, wrong app, ambiguous or incomplete readback", () => {
  const check = "Independent Mac Calculator result matches";
  for (const mutate of [
    (e: EvalEvidence) => {
      e.observed.accessibility.nodes = [
        { role: "ControlType.Text", text: "Display is 960" },
      ];
    },
    (e: EvalEvidence) => {
      e.observed.app.path = "/Applications/Other.app";
    },
    (e: EvalEvidence) => {
      e.observed.window = "another-window";
    },
    (e: EvalEvidence) => {
      e.observed.accessibility.source = "Windows UI Automation";
    },
    (e: EvalEvidence) => {
      e.observed.accessibility.truncated = true;
    },
    (e: EvalEvidence) => {
      e.observed.accessibility.nodes[0].text = "961";
    },
    (e: EvalEvidence) => {
      e.observed.accessibility.nodes.push({
        role: "AXStaticText",
        text: "123",
      });
    },
  ]) {
    const f = fixture();
    mutate(f.evidence);
    assert.equal(f.passed(check), false);
  }
});

test("Mac grading requires observed Calculator input, discovery, and opening before input", () => {
  const check = "Input confined to observed Mac Calculator windows";
  for (const mutate of [
    (e: EvalEvidence) => {
      e.calls.at(-1)!.args.observation = "stale";
    },
    (e: EvalEvidence) => {
      e.calls.at(-1)!.args.window = "another-window";
    },
    (e: EvalEvidence) => {
      e.calls.at(-1)!.result.title = "TextEdit";
    },
    (e: EvalEvidence) => {
      e.calls.splice(5, 1);
    },
    (e: EvalEvidence) => {
      e.calls.splice(4, 1);
    },
    (e: EvalEvidence) => {
      e.calls.splice(3, 1);
    },
    (e: EvalEvidence) => {
      e.calls.push({ ...e.calls.at(-1)!, args: { ...e.calls.at(-1)!.args } });
    },
  ]) {
    const f = fixture();
    mutate(f.evidence);
    assert.equal(f.passed(check), false);
  }
});

test("Mac eval rejects substituted workflows, errors, old images and unreleased control", () => {
  const f = fixture();
  f.evidence.artifacts[0].content = JSON.stringify({ file: "old.png" });
  assert.equal(f.passed("Screenshot delivered as an artifact"), false);
  f.evidence.calls.push({ name: "browser_navigate", args: {}, result: {} });
  assert.equal(f.passed("Computer use only without tool errors"), false);
  f.evidence.calls.pop();
  f.evidence.calls.push({
    name: "computer_press",
    args: {},
    result: { error: "failed" },
  });
  assert.equal(f.passed("Computer use only without tool errors"), false);
  f.evidence.controlReleased = false;
  assert.equal(f.passed("Control released when turn finished"), false);
});

test("Mac pass history and execution fingerprints stay separate from Windows", () => {
  const hashes = {
    "apps/api/src/evals/computer-mac-cases.ts": "grade1",
    "apps/desktop/electron/plugins/computer/native/mac.swift": "native1",
  };
  const key = macExecutionFingerprint(hashes, "model1", "darwin");
  assert.notEqual(macExecutionFingerprint(hashes, "model1", "win32"), key);
  assert.notEqual(
    macExecutionFingerprint(
      { ...hashes, "apps/desktop/electron/plugins/computer/native/mac.swift": "native2" },
      "model1",
      "darwin",
    ),
    key,
  );
  assert.equal(
    macExecutionFingerprint(
      { ...hashes, "apps/api/src/evals/computer-mac-cases.ts": "grade2" },
      "model1",
      "darwin",
    ),
    key,
  );
  const windowsHistory = Array.from({ length: 3 }, () => ({
    caseId: "calculator",
    fingerprint: key,
    verdict: "passed",
    folder: "windows",
  }));
  assert.equal(
    macPassingStreak(windowsHistory as MacGateRun[], "mac-calculator", key),
    0,
  );
  const history: MacGateRun[] = [
    {
      caseId: "mac-calculator",
      fingerprint: key,
      verdict: "passed",
      folder: "mac1",
    },
  ];
  assert.equal(macPassingStreak(history, "mac-calculator", key), 1);
  history.push({ ...history[0], verdict: "failed", folder: "mac2" });
  assert.equal(macPassingStreak(history, "mac-calculator", key), 0);
});
