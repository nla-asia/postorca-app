import { test } from "node:test";
import assert from "node:assert/strict";
import { computerPluginOnly } from "../src/evals/computer-eval-types.js";
import {
  assertGate,
  passingStreak,
  executionFingerprint,
  type GateRun,
} from "../src/evals/computer-gates.js";
import {
  computerCase,
  gradeComputer,
  type EvalEvidence,
} from "../src/evals/computer-cases.js";

test("Edge eval requires desktop-only homepage-to-search navigation and independent Google URL", () => {
  const entry = computerCase("edge-google", 1, "edge");
  assert.equal(entry.manualReview, true);
  const edge = { title: "Google - Microsoft Edge", input_sent: true };
  const evidence: EvalEvidence = {
    status: "completed",
    final: `Searched ${entry.expected.query}`,
    artifacts: [],
    controlReleased: true,
    calls: [
      {
        name: "computer_press",
        args: { key: "t", modifiers: ["control"] },
        result: edge,
      },
      {
        name: "computer_type",
        args: { text: "https://www.google.com" },
        result: edge,
      },
      { name: "computer_press", args: { key: "enter" }, result: edge },
      {
        name: "computer_type",
        args: { text: entry.expected.query },
        result: edge,
      },
      { name: "computer_press", args: { key: "enter" }, result: edge },
    ],
    observed: {
      title: `${entry.expected.query} - Google Search - Microsoft Edge`,
      accessibility: {
        nodes: [
          {
            role: "ControlType.Edit",
            text: `Address and search bar\nhttps://www.google.com/search?q=${encodeURIComponent(entry.expected.query)}`,
          },
        ],
      },
    },
  };
  const check = (name: string) =>
    gradeComputer(entry, evidence).find((c) => c.name === name)?.passed;
  assert.equal(check("Fresh Edge tab before navigation"), true);
  assert.equal(check("Google homepage then exact query submitted"), true);
  assert.equal(
    check("Independent Edge Google results URL matches query"),
    true,
  );
  evidence.observed.title = `${entry.expected.query} - Google Search - Microsoft\u200b Edge`;
  assert.equal(
    check("Independent Edge Google results URL matches query"),
    true,
  );
  evidence.observed.accessibility.nodes[0].role = "ControlType.Hyperlink";
  assert.equal(
    check("Independent Edge Google results URL matches query"),
    false,
  );
  evidence.observed.accessibility.nodes[0].role = "ControlType.Edit";
  evidence.calls[3].args.text = `"${entry.expected.query}"`;
  evidence.observed.accessibility.nodes[0].text = `Address and search bar\nhttps://www.google.com/search?q=${encodeURIComponent(`"${entry.expected.query}"`)}`;
  assert.equal(check("Google homepage then exact query submitted"), true);
  assert.equal(
    check("Independent Edge Google results URL matches query"),
    true,
  );
  evidence.observed.accessibility.nodes[0].text = `Address and search bar\nhttps://www.bing.com/search?q=${encodeURIComponent(entry.expected.query)}`;
  assert.equal(
    check("Independent Edge Google results URL matches query"),
    false,
  );
  evidence.observed.accessibility.nodes[0].text =
    "Address and search bar\nhttps://www.google.com/search?q=wrong";
  assert.equal(
    check("Independent Edge Google results URL matches query"),
    false,
  );
  evidence.calls[1].args.text = `https://www.google.com/search?q=${encodeURIComponent(entry.expected.query)}`;
  assert.equal(check("Google homepage then exact query submitted"), false);
  evidence.calls.push({ name: "browser_navigate", args: {}, result: edge });
  assert.equal(check("Computer use only"), false);
});

test("execution gates survive grader-only changes but reset for native or model changes", () => {
  const hashes = {
    "apps/api/src/evals/computer-cases.ts": "grade1",
    "apps/api/src/scripts/computer-eval.ts": "runner1",
    "apps/desktop/electron/plugins/computer/native/windows.ps1": "native1",
  };
  const original = executionFingerprint(hashes, "model1", "win32");
  assert.equal(
    executionFingerprint(
      { ...hashes, "apps/api/src/evals/computer-cases.ts": "grade2" },
      "model1",
      "win32",
    ),
    original,
  );
  assert.notEqual(
    executionFingerprint(
      { ...hashes, "apps/desktop/electron/plugins/computer/native/windows.ps1": "native2" },
      "model1",
      "win32",
    ),
    original,
  );
  assert.notEqual(executionFingerprint(hashes, "model2", "win32"), original);
});

test("clicking Notepad's plus button is valid fresh-tab creation", () => {
  const entry = computerCase("notepad", 1, "click-tab");
  const checks = gradeComputer(entry, {
    status: "completed",
    calls: [
      {
        name: "computer_click",
        args: {},
        result: { title: "Untitled - Notepad", input_sent: true },
      },
      {
        name: "computer_type",
        args: { text: entry.expected.text },
        result: { title: "PostOrca - Notepad", input_sent: true },
      },
    ],
    final: "done",
    artifacts: [],
    observed: {},
    controlReleased: true,
  });
  assert.equal(
    checks.find((c) => c.name === "Fresh tab before typing")?.passed,
    true,
  );
});
test("app gate requires three consecutive passes on the same runtime", () => {
  const runs: GateRun[] = [
    "passed",
    "passed",
    "failed",
    "passed",
    "passed",
  ].map((verdict, i) => ({
    caseId: "calculator",
    fingerprint: "v1",
    verdict,
    folder: String(i),
  }));
  assert.equal(passingStreak(runs, "calculator", "v1"), 2);
  assert.throws(() => assertGate(runs, "notepad", "v1"), /three consecutive/);
  runs.push({
    caseId: "calculator",
    fingerprint: "v1",
    verdict: "passed",
    folder: "6",
  });
  assert.doesNotThrow(() => assertGate(runs, "notepad", "v1"));
  assert.throws(() => assertGate(runs, "edge-google", "v1"), /notepad/);
  assert.throws(() => assertGate(runs, "notepad", "v2"), /calculator/);
});
test("a correct claimed number cannot pass without independent Calculator state", () => {
  const entry = computerCase("calculator", 1, "x");
  const checks = gradeComputer(entry, {
    status: "completed",
    calls: [],
    final: "The result is 907.",
    artifacts: [],
    observed: {
      title: "Calculator",
      accessibility: { nodes: [{ text: "Display is 56" }] },
    },
    controlReleased: true,
  });
  assert.equal(
    checks.find((c) => c.name === "Final answer reports the same result")
      ?.passed,
    true,
  );
  assert.equal(
    checks.find((c) => c.name === "Independent Calculator result matches")
      ?.passed,
    false,
  );
  assert.ok(checks.some((c) => !c.passed));
});
test("Calculator grading accepts numeric grouping, but not a different app or number", () => {
  const entry = computerCase("calculator", 3, "x");
  const evidence = {
    status: "completed",
    calls: [],
    final: "1,365",
    artifacts: [],
    observed: {
      title: "Calculator",
      accessibility: { nodes: [{ text: "Display is 1,365" }] },
    },
    controlReleased: true,
  };
  assert.equal(
    gradeComputer(entry, evidence).find(
      (c) => c.name === "Independent Calculator result matches",
    )?.passed,
    true,
  );
  assert.equal(
    gradeComputer(entry, evidence).find(
      (c) => c.name === "Final answer reports the same result",
    )?.passed,
    true,
  );
  evidence.observed.title = "Notepad";
  assert.equal(
    gradeComputer(entry, evidence).find(
      (c) => c.name === "Independent Calculator result matches",
    )?.passed,
    false,
  );
});
test("Notepad grading distinguishes whole document readback from visible ending", () => {
  const entry = computerCase("notepad", 1, "run-123");
  const evidence = {
    status: "completed",
    calls: [],
    final: "done",
    artifacts: [],
    observed: {
      accessibility: {
        nodes: [
          {
            text: entry.expected.text.replace(/\n/g, "\r\n"),
            visible_text: "heading only",
          },
        ],
      },
    },
    controlReleased: true,
  };
  const checks = gradeComputer(entry, evidence);
  assert.equal(
    checks.find((c) => c.name === "Exact document readback")?.passed,
    true,
  );
  assert.equal(
    checks.find((c) => c.name === "Ending independently visible")?.passed,
    false,
  );
});

test("delivering an unrelated old image cannot satisfy screenshot delivery", () => {
  const entry = computerCase("calculator", 1, "x");
  const evidence = {
    status: "completed",
    calls: [
      {
        name: "computer_observe",
        args: {},
        result: { attachments: [{ kind: "screenshot", file: "fresh.png" }] },
      },
    ],
    final: "907",
    artifacts: [
      { kind: "image", content: JSON.stringify({ file: "old.png" }) },
    ],
    observed: {},
    controlReleased: true,
  };
  assert.equal(
    gradeComputer(entry, evidence).find(
      (c) => c.name === "Screenshot delivered as an artifact",
    )?.passed,
    false,
  );
  evidence.artifacts[0].content = JSON.stringify({ file: "fresh.png" });
  assert.equal(
    gradeComputer(entry, evidence).find(
      (c) => c.name === "Screenshot delivered as an artifact",
    )?.passed,
    true,
  );
});

test("Notepad exact-text check rejects extra document content", () => {
  const entry = computerCase("notepad", 1, "nonce");
  const evidence = {
    status: "completed",
    calls: [],
    final: "done",
    artifacts: [],
    observed: {
      accessibility: {
        nodes: [
          {
            text: `Text editor\n${entry.expected.text}\r`,
            visible_text: entry.expected.ending,
          },
        ],
      },
    },
    controlReleased: true,
  };
  assert.equal(
    gradeComputer(entry, evidence).find(
      (c) => c.name === "Exact document readback",
    )?.passed,
    true,
  );
  evidence.observed.accessibility.nodes[0].text = `Text editor\nUNREQUESTED\n${entry.expected.text}`;
  assert.equal(
    gradeComputer(entry, evidence).find(
      (c) => c.name === "Exact document readback",
    )?.passed,
    false,
  );
});

test("switching back to the default tools is not a substitute workflow", () => {
  const plugin = (code: unknown) => ({ name: "activate_plugin", args: { code }, result: {} });
  for (const code of ["computer", null, "null"]) assert.equal(computerPluginOnly(plugin(code)), true, String(code));
  assert.equal(computerPluginOnly(plugin("browser")), false);
  assert.equal(computerPluginOnly({ name: "computer_click", args: {}, result: {} }), true);
});
