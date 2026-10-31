import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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
import { editCases } from "../edit-cases.js";
import { caseSchema, type EvalCase } from "./contracts.js";

/** A fixture whose script and files are pinned by hash: the Streaks repo the "from
 * your work" cases read, and the music track handed to the mixing case. */
const repoFile = (path: string) =>
  fileURLToPath(new URL(`../../../../../${path}`, import.meta.url));
const pinned = (path: string) => ({
  path,
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
});
// Packlight is a real Expo source tree rather than one self-contained generator.
// Pin its complete checked-in input, excluding build/dependency output.
const packlightFiles = (dir = "scripts/evals/fixtures/packlight"): string[] =>
  readdirSync(repoFile(dir), { withFileTypes: true })
    .filter(
      (entry) =>
        !["node_modules", ".expo", "dist", "dist-ios", ".git"].includes(
          entry.name,
        ),
    )
    .flatMap((entry) =>
      entry.isDirectory()
        ? packlightFiles(`${dir}/${entry.name}`)
        : [`${dir}/${entry.name}`],
    )
    .sort();
const fixture = (script: string, files: string[] = [], extra: string[] = []) => {
  if (script === "scripts/evals/packlight-fixture.mjs")
    files = [...files, ...packlightFiles()];
  const hook = (mode: string) => ({
    executable: process.execPath,
    args: [repoFile(script), mode, ...extra],
    ...(script === "scripts/evals/packlight-fixture.mjs"
      ? { timeout_ms: 180_000 }
      : {}),
  });
  return {
    files: [script, ...files].map((f) => pinned(repoFile(f))),
    prepare: hook("prepare"),
    observe: hook("observe"),
    cleanup: hook("cleanup"),
  };
};
const workFixture = () => fixture("scripts/evals/work-fixture.mjs");
const musicFixture = () =>
  fixture("scripts/evals/music-fixture.mjs", [
    "fixtures/evals/music/sleepy-cat-lofi.mp3",
  ]);
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
  const edits = editCases.map((c) =>
    caseSchema.parse({
      id: `content-${c.id}`,
      plugin: "content",
      level: 3,
      title: c.name,
      turns: [
        {
          brief: c.brief,
          video_case: c.id,
          video_expect: { exports: 1, seconds: c.video.seconds },
          exports: 1,
        },
      ],
      criteria: criteria(c.criteria),
      fixture: fixture(
        "scripts/evals/recordings-fixture.mjs",
        [...c.clips, ...(c.music ? [c.music] : [])].map(
          (file) => `fixtures/evals/recordings/${c.set}/${file}`,
        ),
        [c.set],
      ),
      prerequisites: ["desktop_connected", "working_folder_set", "media_providers_ready"],
      source: "apps/api/src/evals/edit-cases.ts",
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
      ...(c.fixture_script
        ? { fixture: fixture(c.fixture_script) }
        : c.read_work
          ? { fixture: workFixture() }
          : {}),
      prerequisites: [
        "desktop_connected",
        ...(c.script_only ? [] : ["screen_recording_permission"]),
        ...(c.app === "simulator" ? ["simulator_iphone_booted"] : []),
        ...(c.app === "web" ? ["browser_connected"] : []),
        ...(c.read_work || c.fixture_script
          ? ["work_fixture_project_added", "fixture_ready"]
          : []),
        ...(c.video ? ["media_providers_ready"] : []),
      ],
      source: "apps/api/src/evals/computer-demo-cases.ts",
    }),
  );
  // F cases test one video process (Media level 2); C cases are end-to-end Content.
  const kept = ["F3", "F6", "C1"];
  const contentIds: Record<string, string> = { C1: "reel-with-music" };
  const videos = videoCases
    .filter((c) => kept.includes(c.id))
    .map((c) => {
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
      const content = c.id in contentIds;
      return caseSchema.parse({
        id: content ? `content-${contentIds[c.id]}` : `video-${c.id}`,
        plugin: content ? "content" : "media",
        level: content ? 3 : 2,
        ...(c.expect.music?.title ? { fixture: musicFixture() } : {}),
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
          ...(c.expect.music?.title ? ["fixture_ready"] : []),
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
    ...edits,
    caseSchema.parse({
      id: "media-M1",
      revision: 3,
      revision_change: {
        from: 2,
        reason:
          "Music generation is out of scope: the provider key has no access to it (HTTP 402 limited_access on the first live run). Every other media tool stays.",
        preserved_coverage: [
          "media-M1 image generation, image edit, voices, exact speech, sound effect and transcription",
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
        prerequisites: ["media_providers_ready", "brand_profile_ready"],
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
        routine: { skill: c.skill, platform: c.platform ?? "X" },
        ...(c.work
          ? {
              fixture: c.fixture_script
                ? fixture(c.fixture_script)
                : workFixture(),
            }
          : {}),
        prerequisites: [
          "brand_profile_ready",
          "desktop_connected",
          ...(c.proposes ? [] : ["browser_connected"]),
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
        ...(c.revision ? { revision: c.revision } : {}),
        ...(c.revision_change ? { revision_change: c.revision_change } : {}),
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
