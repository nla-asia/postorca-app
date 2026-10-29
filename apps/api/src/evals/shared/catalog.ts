import { browserCases } from "../browser-cases.js";
import { computerCase, computerCaseOrder } from "../computer-cases.js";
import {
  macComputerCase,
  macComputerCaseOrder,
} from "../computer-mac-cases.js";
import { mediaAgentCase, videoCases } from "../video-cases.js";
import { demoCases } from "../computer-demo-cases.js";
import { caseSchema, type EvalCase } from "./contracts.js";

const criteria = (texts: string[]) =>
  texts.map((text, i) => ({ id: `outcome-${i + 1}`, text }));
const bullets = (text: string) =>
  text
    .split(/\r?\n/)
    .map((s) => s.replace(/^-\s*/, "").trim())
    .filter(Boolean);
const mediaRevision =
  "Revise the image you just made: change only the terracotta pot to blue. Preserve the green sprout, square framing and cream background. Deliver the revised image as a new artifact, keeping the original. Keep the existing speech; do not generate it again.";

/** All existing case IDs enter one lifecycle. No three-case browser allowlist.
 * Legacy contracts are retained as review criteria until independently verified;
 * listing a case never implies that its environment or fixtures are ready.
 */
export function builtinCases(attempt = 1, nonce = "project-notes"): EvalCase[] {
  const browser = browserCases.map((c) =>
    caseSchema.parse({
      id: `browser-${c.id}`,
      ...(c.revision ? { revision: c.revision } : {}),
      ...(c.revision_change ? { revision_change: c.revision_change } : {}),
      plugin: "browser",
      title: c.name,
      turns: [{ brief: c.brief }],
      criteria: criteria(bullets(c.success_criteria)),
      prerequisites: ["browser_connected"],
      source: "apps/api/src/evals/browser-cases.ts",
    }),
  );
  const computers = [
    ...computerCaseOrder.map((id) => ({
      entry: computerCase(id, attempt, nonce),
      platform: "win32",
    })),
    ...macComputerCaseOrder.map((id) => ({
      entry: macComputerCase(id, attempt, nonce),
      platform: "darwin",
    })),
  ].map(({ entry: c, platform }) =>
    caseSchema.parse({
      id: `computer-${c.id}`,
      plugin: "computer",
      title: c.name,
      platform,
      level: 1,
      turns: [{ brief: c.brief }],
      criteria: criteria(
        c.manualReview
          ? c.criteria.filter((text) =>
              /summary|summari|observer|review|titles|recording|movie|video frames|maps|bangkok/i.test(
                text,
              ),
            )
          : [],
      ),
      grading_mode: c.manualReview ? "hybrid" : "programmatic",
      computer: { id: c.id, attempt, nonce, contract: c },
      prerequisites: ["desktop_connected", "independent_observer_ready"],
      source: `apps/api/src/evals/computer-${platform === "darwin" ? "mac-" : ""}cases.ts`,
    }),
  );
  const demos = demoCases.map((c) =>
    caseSchema.parse({
      id: `computer-${c.id}`,
      plugin: "computer",
      title: c.name,
      platform: "darwin",
      level: c.level,
      turns: [
        c.video
          ? {
              brief: c.brief,
              video_case: c.id,
              video_expect: { exports: 1, seconds: c.video.seconds },
              exports: 1,
            }
          : { brief: c.brief },
      ],
      criteria: criteria(c.criteria),
      demo: c,
      prerequisites: [
        "desktop_connected",
        "screen_recording_permission",
        ...(c.app === "simulator" ? ["simulator_iphone_booted"] : []),
        ...(c.video ? ["media_providers_ready"] : []),
      ],
      source: "apps/api/src/evals/computer-demo-cases.ts",
    }),
  );
  const videos = videoCases.map((c) => {
    const parent =
      "of" in c.start
        ? videoCases.find((v) => v.id === (c.start as { of: string }).of)!
        : undefined;
    const first = parent ?? c;
    const expected = Array.isArray(c.expect.exports)
      ? c.expect.exports
      : [c.expect.exports];
    const turns =
      "brief" in c.start
        ? [
            {
              brief: c.start.brief,
              video_case: c.id,
              video_expect: c.expect,
              exports: expected[0],
            },
          ]
        : [
            {
              brief: (first.start as { brief: string }).brief,
              video_case: first.id,
              video_expect: first.expect,
              exports: Number(first.expect.exports),
            },
            ...c.start.messages.map((brief, i) => ({
              brief,
              video_case: c.id,
              video_expect: c.expect,
              exports: expected[i],
            })),
          ];
    return caseSchema.parse({
      id: `video-${c.id}`,
      ...(c.revision ? { revision: c.revision } : {}),
      ...(c.revision_change ? { revision_change: c.revision_change } : {}),
      plugin: "video",
      title: c.name,
      turns,
      criteria: criteria([
        "The delivered videos fulfill the frozen user requests; exact facts, readable text, image quality, and relevant shots are verified from the actual outputs.",
        `Independently inspect the delivered files, including duration, dimensions, audio streams and these original case expectations: ${JSON.stringify(c.expect)}.`,
        ...(c.expect.music?.source === "web"
          ? [
              "The music was found online and downloaded as an original audio file; it fits the requested mood, is free to use for this reel under its published license, and its source and any required credit are reported and match the page it came from.",
            ]
          : []),
      ]),
      prerequisites: [
        "desktop_connected",
        "media_providers_ready",
        ...(c.expect.screens ? ["supplied_screenshots_ready"] : []),
        ...(c.expect.music?.source === "web" ? ["browser_connected"] : []),
        ...(c.expect.music && c.expect.music.source !== "web"
          ? ["supplied_music_ready"]
          : []),
        ...(c.expect.noProfileColors
          ? ["profile_colours_cleared_with_restore_plan"]
          : []),
      ],
      source: "apps/api/src/evals/video-cases.ts",
    });
  });
  return [
    ...browser,
    ...computers,
    ...demos,
    caseSchema.parse({
      id: "media-M1",
      plugin: "media",
      title: mediaAgentCase.name,
      turns: [
        { brief: (mediaAgentCase.start as { brief: string }).brief },
        { brief: mediaRevision },
      ],
      prerequisites: ["media_providers_ready"],
      criteria: criteria([
        "The original square image contains the green sprout, terracotta pot, cream background and no text; the speech says exactly the requested sentence and sounds correct on complete listening.",
        "The revision changes only the pot to blue, preserving composition and original image availability. Speech remains available and is not regenerated.",
        "Reopening the task preserves both images and playable speech; original-source checksums match authenticated downloads.",
      ]),
      source: "apps/api/src/evals/video-cases.ts#mediaAgentCase",
    }),
    ...videos,
  ];
}

export function renderParameters(
  entry: EvalCase,
  parameters: Record<string, string>,
): EvalCase {
  const turns = entry.turns.map((turn) => {
    let brief = turn.brief;
    for (const [key, value] of Object.entries(parameters))
      brief = brief.replaceAll(`[${key}]`, value);
    const missing = brief.match(/\[[^\]\r\n]+\]/g);
    if (missing)
      throw new Error(
        `Missing brief parameters: ${[...new Set(missing)].join(", ")}`,
      );
    return { ...turn, brief };
  });
  return caseSchema.parse({ ...entry, turns });
}
