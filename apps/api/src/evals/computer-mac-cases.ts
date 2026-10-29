import {
  computerPluginOnly,
  type ComputerEvalCase,
  type EvalCheck,
  type EvalEvidence,
} from "./computer-eval-types.js";

export const macComputerCaseOrder = ["mac-calculator"] as const;
export type MacComputerCaseId = (typeof macComputerCaseOrder)[number];
export const macCalculatorPath = "/System/Applications/Calculator.app";

export function macComputerCase(
  id: MacComputerCaseId,
  attempt: number,
  _nonce: string,
): ComputerEvalCase<MacComputerCaseId> {
  if (id !== "mac-calculator") throw new Error(`Unknown Mac case: ${id}`);
  const [a, b, adjustment] = [
    [41, 23, 17],
    [67, 14, -29],
    [53, 26, 11],
  ][(attempt - 1) % 3];
  return {
    id,
    name: "macOS Calculator use",
    manualReview: false,
    brief: `Use the built-in macOS Calculator desktop app to multiply ${a} by ${b}, then ${adjustment < 0 ? "subtract" : "add"} ${Math.abs(adjustment)}. Start a fresh calculation, perform the operations in the app, report the final number, and leave Calculator displaying that result. Include a screenshot of the result here. Use only the computer-use plugin for app discovery and interaction; do not use browser, file, shell, network, another calculation method, or cross-task memory as a substitute. This is a temporary desktop check; do not change app settings or edit unrelated content.`,
    expected: { result: a * b + adjustment, appPath: macCalculatorPath },
    criteria: [
      "The real internal agent discovers and opens built-in macOS Calculator through computer use.",
      "Every input uses the latest observation for a discovered Calculator window.",
      "Independent macOS Accessibility readback from the Calculator bundle contains one unambiguous numeric AXStaticText result matching the answer.",
      "The agent delivers a screenshot from this run and releases desktop control.",
      "No substitute workflows, tool errors, or unrelated app input occur.",
    ],
  };
}

export function gradeMacComputer(
  entry: ComputerEvalCase<MacComputerCaseId>,
  evidence: EvalEvidence,
): EvalCheck[] {
  const { calls, observed } = evidence;
  const successful = calls.filter((c) => c.result && !c.result.error);
  const allowed = new Set([
    "desktop_status",
    "activate_plugin",
    "read_skill",
    "computer_list_apps",
    "computer_open",
    "computer_observe",
    "computer_click",
    "computer_type",
    "computer_press",
    "computer_scroll",
    "create_artifact",
  ]);
  const inputNames = new Set([
    "computer_click",
    "computer_type",
    "computer_press",
    "computer_scroll",
  ]);
  const calculatorWindows = new Set<string>();
  const observations = new Map<string, string>();
  let safeInput = true;
  let inputCount = 0;
  let discovered = false;
  let opened = false;
  for (const call of successful) {
    if (["computer_list_apps", "computer_open"].includes(call.name)) {
      for (const app of call.result.apps ?? []) {
        if (app.id !== macCalculatorPath || app.path !== macCalculatorPath)
          continue;
        if (call.name === "computer_list_apps") discovered = true;
        if (
          call.name === "computer_open" &&
          discovered &&
          call.args.app_id === macCalculatorPath
        )
          opened = true;
        for (const window of app.windows ?? [])
          calculatorWindows.add(window.id);
      }
    }
    if (inputNames.has(call.name)) {
      inputCount++;
      safeInput &&=
        opened &&
        calculatorWindows.has(call.args.window) &&
        observations.has(call.args.window) &&
        observations.get(call.args.window) === call.args.observation &&
        call.result.window === call.args.window &&
        call.result.title === "Calculator" &&
        call.result.input_sent === true;
      observations.delete(call.args.window);
    }
    if (call.name === "computer_observe" || inputNames.has(call.name)) {
      if (
        call.result.window === call.args.window &&
        typeof call.result.observation === "string" &&
        call.result.attachments?.some((a: any) => a.kind === "screenshot")
      ) {
        observations.set(call.result.window, call.result.observation);
      }
    }
  }
  const screenshots = new Set(
    successful
      .flatMap((c) => c.result.attachments ?? [])
      .filter((a: any) => a.kind === "screenshot")
      .map((a: any) => a.file),
  );
  const delivered = evidence.artifacts.some((artifact) => {
    if (artifact.kind !== "image") return false;
    try {
      const content =
        typeof artifact.content === "string"
          ? JSON.parse(artifact.content)
          : artifact.content;
      return screenshots.has(content?.file);
    } catch {
      return false;
    }
  });
  // macOS adds directional marks to the display; numeric grouping is not a different result.
  const displays = (observed?.accessibility?.nodes ?? [])
    .filter((node: any) => node.role === "AXStaticText")
    .map((node: any) =>
      String(node.text ?? "")
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
        .trim(),
    )
    .filter((text: string) => /^-?\d[\d,\s]*$/.test(text))
    .map((text: string) => text.replace(/[,\s]/g, ""));
  return [
    { name: "Turn completed", passed: evidence.status === "completed" },
    {
      name: "Mac desktop checked, plugin activated and skill read",
      passed:
        successful.some(
          (c) =>
            c.name === "desktop_status" &&
            c.result.plugins?.computer?.platform === "darwin",
        ) &&
        successful.some(
          (c) => c.name === "activate_plugin" && c.args.code === "computer",
        ) &&
        successful.some(
          (c) => c.name === "read_skill" && c.args.name === "computer-use",
        ),
    },
    {
      name: "Built-in Mac Calculator discovered and opened",
      passed: discovered && opened,
    },
    {
      name: "Input confined to observed Mac Calculator windows",
      passed: inputCount > 0 && safeInput,
    },
    {
      name: "Independent Mac Calculator result matches",
      passed:
        observed?.app?.id === macCalculatorPath &&
        observed?.app?.path === macCalculatorPath &&
        calculatorWindows.has(observed?.window) &&
        observed?.title === "Calculator" &&
        observed?.accessibility?.source === "macOS Accessibility" &&
        observed?.accessibility?.truncated === false &&
        displays.length === 1 &&
        displays[0] === String(entry.expected.result),
      details: { expected: entry.expected.result, displays },
    },
    {
      name: "Final answer reports the same result",
      passed: new RegExp(`\\b${entry.expected.result}\\b`).test(
        evidence.final.replace(/,/g, ""),
      ),
    },
    {
      name: "Real app input and screenshot evidence",
      passed:
        inputCount > 0 &&
        screenshots.size > 0 &&
        !!observed?.attachments?.length,
    },
    { name: "Screenshot delivered as an artifact", passed: delivered },
    {
      name: "Computer use only without tool errors",
      passed:
        successful.length === calls.length &&
        calls.every(
          (c) =>
            allowed.has(c.name) && computerPluginOnly(c),
        ),
    },
    {
      name: "Control released when turn finished",
      passed: evidence.controlReleased,
    },
  ];
}
