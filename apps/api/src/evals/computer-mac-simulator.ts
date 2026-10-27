import { basename } from "node:path";
import type {
  ComputerEvalCase,
  EvalCheck,
  EvalEvidence,
} from "./computer-eval-types.js";

export const simulatorApp = (app: any) =>
  app?.name === "Simulator" &&
  /\/Contents\/Developer\/Applications\/Simulator\.app$/.test(
    app?.path ?? "",
  ) &&
  app.id === app.path;
export function simulatorCase(
  id: "mac-simulator-maps",
  nonce: string,
): ComputerEvalCase<"mac-simulator-maps"> {
  return {
    id,
    name: "macOS Simulator Maps recording",
    manualReview: true,
    brief: `Open the iOS Simulator desktop app and wait for an iPhone device to finish booting and become usable; launch may take a while. Open the built-in Maps app. In Simulator's actual File menu choose Record Screen. While recording, perform a fresh search for Bangkok, Thailand, clearing any previous query first, and select the city so its map/place result is clearly visible. Perform the search even if Maps initially shows Bangkok from an earlier session. Stop recording through File → Stop Recording and allow the native recording to finish saving to the Desktop. Wait for the floating recording preview/export window to disappear before quitting; native saving can take over a minute. Keep the main iPhone window selected for bounded observation waits, and re-list Simulator windows to check progress. Do not attempt to focus or interact with the floating recording preview. An enabled Record Screen item alone does not prove saving finished. Capture a screenshot of the Bangkok result before quitting. Then quit Simulator and confirm it is no longer running. Keep the UI steps within Simulator; do not open Finder or another desktop app. Leave the recording in the default Desktop location; its exact generated filename does not need to be reported. Report only what you verified and deliver the result screenshot here. This is temporary Mac computer-use eval ${nonce}. Use the computer-use plugin for all app actions, including actual menu clicks (not recording shortcuts). Do not use simctl, shell/scripts, browser/network tools, screen_record_start/stop, file tools, other plugins, or memory as substitutes. Do not change Simulator settings or erase device data. Handle ordinary Maps welcome/permission prompts as needed; do not sign into accounts. If a step fails, describe the observed blocker rather than claiming success.`,
    expected: { query: "Bangkok", country: "Thailand" },
    criteria: [
      "Simulator starts from a closed app and powered-off device fixture, then Maps becomes usable.",
      "The agent uses the actual File menu to start recording before typing Bangkok and to stop after viewing the city result.",
      "A new non-empty decodable native Simulator video is independently found on the Desktop and retained.",
      "An observer reviews screenshots and video frames for Maps, the Bangkok search, and the Bangkok/Thailand result.",
      "Simulator is independently confirmed exited and desktop control is released.",
    ],
  };
}
export function gradeSimulator(
  _entry: ComputerEvalCase,
  evidence: EvalEvidence,
): EvalCheck[] {
  const { calls, observed } = evidence;
  const success = calls.filter((c) => c.result && !c.result.error);
  const inputNames = new Set([
    "computer_click",
    "computer_type",
    "computer_press",
    "computer_scroll",
  ]);
  const allowed = new Set([
    "desktop_status",
    "activate_plugin",
    "read_skill",
    "computer_list_apps",
    "computer_open",
    "computer_observe",
    ...inputNames,
    "create_artifact",
  ]);
  const menu = (call: any, leaf: string) =>
    call.name === "computer_click" &&
    call.result?.input_sent === true &&
    JSON.stringify(call.args.menu_path) === JSON.stringify(["File", leaf]);
  const start = calls.findIndex((c) => menu(c, "Record Screen"));
  const search = calls.findIndex(
    (c, i) =>
      i > start &&
      c.name === "computer_type" &&
      c.result?.input_sent === true &&
      /^Bangkok(?:,? Thailand)?$/i.test(c.args.text?.trim() ?? ""),
  );
  const stop = calls.findIndex(
    (c, i) => i > search && menu(c, "Stop Recording"),
  );
  const quit = calls.findIndex(
    (c, i) =>
      i > stop &&
      c.name === "computer_click" &&
      c.result?.input_sent === true &&
      JSON.stringify(c.args.menu_path) ===
        JSON.stringify(["Simulator", "Quit Simulator"]),
  );
  const simulatorIds = new Set(
    success
      .flatMap((c) => c.result.apps ?? [])
      .filter(simulatorApp)
      .map((app: any) => app.id),
  );
  const windows = new Set<string>();
  const observations = new Map<string, string>();
  let confined = true,
    inputCount = 0;
  for (const c of success) {
    for (const app of c.result.apps ?? [])
      if (simulatorApp(app))
        for (const w of app.windows ?? []) windows.add(w.id);
    if (inputNames.has(c.name)) {
      inputCount++;
      confined &&=
        windows.has(c.args.window) &&
        observations.has(c.args.window) &&
        observations.get(c.args.window) === c.args.observation &&
        c.result.window === c.args.window &&
        c.result.input_sent === true;
      observations.delete(c.args.window);
    }
    if (
      c.result.observation &&
      c.result.attachments?.some((a: any) => a.kind === "screenshot")
    )
      observations.set(c.result.window, c.result.observation);
  }
  const screenshots = new Set(
    success
      .flatMap((c) => c.result.attachments ?? [])
      .filter((a: any) => a.kind === "screenshot")
      .map((a: any) => a.file),
  );
  const delivered = evidence.artifacts.some((a) => {
    try {
      return (
        a.kind === "image" &&
        screenshots.has(
          (typeof a.content === "string" ? JSON.parse(a.content) : a.content)
            ?.file,
        )
      );
    } catch {
      return false;
    }
  });
  const recordings = observed?.recordings ?? [];
  const simulator = observed?.apps?.find(simulatorApp);
  const claimedFiles =
    evidence.final.match(/Simulator Screen Recording [^`\n]+?\.(?:mov|mp4)/g) ??
    [];
  const actualFiles = new Set(
    recordings.map((recording: any) => basename(recording.source ?? "")),
  );
  return [
    { name: "Turn completed", passed: evidence.status === "completed" },
    {
      name: "Mac desktop checked, plugin activated and skill read",
      passed:
        success.some(
          (c) =>
            c.name === "desktop_status" &&
            c.result.plugins?.computer?.platform === "darwin",
        ) &&
        success.some(
          (c) => c.name === "activate_plugin" && c.args.code === "computer",
        ) &&
        success.some(
          (c) => c.name === "read_skill" && c.args.name === "computer-use",
        ),
    },
    {
      name: "Simulator discovered and opened from cold fixture",
      passed:
        observed?.coldFixture === true &&
        success.some(
          (c) => c.name === "computer_open" && simulatorIds.has(c.args.app_id),
        ),
    },
    {
      name: "File menu recording surrounds Bangkok search",
      passed: start >= 0 && search > start && stop > search && quit > stop,
    },
    {
      name: "Input confined to observed Simulator windows",
      passed: inputCount > 0 && confined,
    },
    {
      name: "New native Simulator recording independently verified",
      passed:
        recordings.length === 1 &&
        recordings[0].size > 0 &&
        recordings[0].duration_seconds > 0 &&
        recordings[0].width > 0 &&
        recordings[0].height > 0 &&
        !!recordings[0].retained,
    },
    { name: "Result screenshot delivered", passed: delivered },
    {
      name: "Claimed recording filename matches this run",
      passed: claimedFiles.every((name) => actualFiles.has(name)),
      details: { claimedFiles, actualFiles: [...actualFiles] },
    },
    {
      name: "Simulator independently exited",
      passed:
        simulator?.running === false &&
        simulator.windows.length === 0 &&
        observed?.simulatorRunning === false,
    },
    {
      name: "Computer use only without tool errors",
      passed:
        success.length === calls.length &&
        calls.every(
          (c) =>
            allowed.has(c.name) &&
            (c.name !== "computer_open" || simulatorIds.has(c.args.app_id)) &&
            (c.name !== "activate_plugin" || c.args.code === "computer"),
        ),
    },
    {
      name: "Control released when turn finished",
      passed: evidence.controlReleased,
    },
  ];
}
