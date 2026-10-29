import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { browserCases } from "../browser-cases.js";
import { ideasCases, routineInstructions } from "../ideas-cases.js";
import { computerCase, computerCaseOrder } from "../computer-cases.js";
import {
  macComputerCase,
  macComputerCaseOrder,
} from "../computer-mac-cases.js";
import { videoCases } from "../video-cases.js";
import {
  mediaToolsCase,
  quoteCardCase,
  voiceoverCase,
} from "../media-cases.js";
import { writingCases, writingToolsCase } from "../writing-cases.js";
import { browserToolsCase } from "../browser-tools.js";
import { demoCases } from "../computer-demo-cases.js";
import { caseSchema, type EvalCase } from "./contracts.js";

/** The Streaks repo the "from your work" cases read; its script is pinned by hash. */
const workScript = fileURLToPath(
  new URL("../../../../../scripts/evals/work-fixture.mjs", import.meta.url),
);
const workHook = (mode: string) => ({
  executable: process.execPath,
  args: [workScript, mode],
});
const workFixture = () => ({
  files: [
    {
      path: workScript,
      sha256: createHash("sha256").update(readFileSync(workScript)).digest("hex"),
    },
  ],
  prepare: workHook("prepare"),
  observe: workHook("observe"),
  cleanup: workHook("cleanup"),
});
const criteria = (texts: string[]) =>
  texts.map((text, i) => ({ id: `outcome-${i + 1}`, text }));
const bullets = (text: string) =>
  text
    .split(/\r?\n/)
    .map((s) => s.replace(/^-\s*/, "").trim())
    .filter(Boolean);
/** `plugin` is the case's category: browser, computer and media (levels 1–2)
 * test tools and processes, writing (level 2) the founder's voice, and content
 * (level 3) end-to-end work. Case IDs stay stable when a case changes category.
 *
 * All existing case IDs enter one lifecycle. No three-case browser allowlist.
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
      level: 2,
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
      id: `${c.level === 3 ? "content" : "computer"}-${c.id}`,
      plugin: c.level === 3 ? "content" : "computer",
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
      ...(c.read_work ? { fixture: workFixture() } : {}),
      prerequisites: [
        "desktop_connected",
        "screen_recording_permission",
        ...(c.app === "simulator" ? ["simulator_iphone_booted"] : []),
        ...(c.app === "web" ? ["browser_connected"] : []),
        ...(c.read_work ? ["work_fixture_project_added", "fixture_ready"] : []),
        ...(c.video ? ["media_providers_ready"] : []),
      ],
      source: "apps/api/src/evals/computer-demo-cases.ts",
    }),
  );
  // Story reels (B cases) wait for the Content redesign; F cases test one video process.
  const kept = ["F3", "F9", "F6"];
  const videos = videoCases.filter((c) => kept.includes(c.id)).map((c) => {
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
      plugin: "media",
      level: 2,
      ...(c.revision ? { revision: c.revision } : {}),
      ...(c.revision_change ? { revision_change: c.revision_change } : {}),
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
    caseSchema.parse({
      id: `browser-${browserToolsCase.id}`,
      plugin: "browser",
      level: 1,
      title: browserToolsCase.name,
      turns: [{ brief: browserToolsCase.brief }],
      criteria: criteria(browserToolsCase.criteria),
      prerequisites: ["browser_connected"],
      source: "apps/api/src/evals/browser-tools.ts",
    }),
    ...browser,
    ...computers,
    ...demos,
    caseSchema.parse({
      id: "media-M1",
      revision: 2,
      revision_change: {
        from: 1,
        reason:
          "M1 becomes the media tool health check: every media tool in one task, with speech and transcription checking each other.",
        preserved_coverage: [
          "media-M1 image generation, image edit and exact speech",
        ],
      },
      plugin: "media",
      level: 1,
      title: mediaToolsCase.name,
      turns: mediaToolsCase.turns.map((brief) => ({ brief })),
      prerequisites: ["media_providers_ready"],
      criteria: criteria(mediaToolsCase.criteria),
      source: "apps/api/src/evals/media-cases.ts",
    }),
    ...videos,
    ...[quoteCardCase, voiceoverCase].map((c) =>
      caseSchema.parse({
        id: `media-${c.id}`,
        plugin: "media",
        level: 2,
        title: c.name,
        turns: [{ brief: c.brief }],
        criteria: criteria(c.criteria),
        prerequisites: [
          "media_providers_ready",
          "brand_profile_ready",
        ],
        source: "apps/api/src/evals/media-cases.ts",
      }),
    ),
    caseSchema.parse({
      id: `writing-${writingToolsCase.id}`,
      plugin: "writing",
      level: 1,
      title: writingToolsCase.name,
      turns: [{ brief: writingToolsCase.brief }],
      criteria: criteria(writingToolsCase.criteria),
      prerequisites: ["saved_posts_present"],
      source: "apps/api/src/evals/writing-cases.ts#writingToolsCase",
    }),
    ...ideasCases.map((c) =>
      caseSchema.parse({
        id: `ideas-${c.id}`,
        plugin: "ideas",
        level: 3,
        title: c.name,
        turns: [{ brief: routineInstructions(c.skill) }],
        criteria: criteria(c.criteria),
        routine: { skill: c.skill, platform: "X" },
        ...(c.work ? { fixture: workFixture() } : {}),
        prerequisites: [
          "brand_profile_ready",
          "desktop_connected",
          "browser_connected",
          ...(c.work
            ? [
                "work_fixture_project_added",
                "work_ideas_memory_cleared",
                "fixture_ready",
              ]
            : []),
        ],
        source: "apps/api/src/evals/ideas-cases.ts",
      }),
    ),
    ...writingCases.map((c) =>
      caseSchema.parse({
        id: `${c.category}-${c.id}`,
        plugin: c.category,
        level: c.level,
        title: c.name,
        turns: c.turns.map((brief) => ({ brief })),
        criteria: criteria(c.criteria),
        writing: c.expect,
        prerequisites: [
          "brand_profile_ready",
          ...(c.expect.research ? ["browser_connected"] : []),
          ...(c.expect.image ? ["media_providers_ready"] : []),
        ],
        source: "apps/api/src/evals/writing-cases.ts",
      }),
    ),
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
