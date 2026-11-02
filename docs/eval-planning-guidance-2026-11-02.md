# Planning guidance pilot — 2 November 2026

## Change and purpose

The planning skill already asked Orca to read the code, inspect the running app,
and cut unnecessary shots. It did not distinguish understanding the executable
process from choosing the viewer's story clearly enough.

The update asks Orca to trace the relevant actions through their conditions,
state changes and results; distinguish required, optional and independent actions;
and check that the next action is reachable. Preparation and non-obvious
transitions belong in recording notes. Narration and shots earn their place by
helping the viewer understand the feature or its payoff. Routine actions can be
silent, prepared off camera or crossed with an intentional cut that preserves
real product behavior. Optional actions remain a relevance decision.

The guidance names no fixture, expected answer, locator or forbidden control.
The general wording also permits a voice appropriate to the founder and content,
while grounding product capabilities and outcomes in inspected behavior.

## Fixed live comparison

Before execution, the observer fixed a three-attempt plan: two fresh Packlight
how-to tasks, followed by one Ledgerly what's-new task. All used Meta
`muse-spark-1.3`, the original briefs, pinned fixtures and unchanged semantic
criteria. The API served this worktree's updated skill with the existing account
and storage. Each attempt retains an attestation matching the exact skill body
returned by `read_skill` to the edited file. Private evidence stays ignored in
`.data/evals/`; the user-facing app did not receive evaluator coaching.

| Case | Reviewed result | Process continuity | Remaining finding | App credits |
| --- | --- | --- | --- | ---: |
| Packlight how-to, attempt 1 | Failed step-selection criterion | Silent modal dismissal in recording notes before Share | Preview is still narrated as a step | 5 |
| Packlight how-to, attempt 2 | Failed step-selection criterion | Explicit dismissal with a cut before Share | Preview is still narrated as a step | 4 |
| Ledgerly what's-new | Passed | Preparation stays in recording notes | Minor wording choices remain available for founder feedback | 7 |

The original Packlight attempt omitted the modal dismissal. Both updated runs
make that transition executable without adding a spoken dismissal instruction.
They still fail the frozen criterion excluding Preview from this particular
sharing how-to. This is observed partial improvement in process understanding,
not evidence that editorial selection is now consistently correct. A preview
could be valuable in another task; this finding does not justify a global ban.

The transfer script covers the five user-facing changes in six shots, with
viewer-oriented narration. The chart now refers to the current month highlight,
and Print/PDF is described without an exact one-click completion claim. The UI
term "modal" in one spoken line remains a small editorial choice for review.

Attempt IDs:

- `content-script-packlight-how-to-b9033f54-4451-4373-a57e-e7a0d9a39086`
- `content-script-packlight-how-to-b8fb73a2-ae05-48b2-bc5f-5d6b7e17f211`
- `content-script-ledgerly-whats-new-e8ed716e-5eb5-49a1-84f2-8981a478d4f6`

The second Packlight run retains one recovered infrastructure diagnostic:
`list_capture_targets` reports that screen capture is macOS-only in this desktop.
It does not change the step-selection finding. Native sharing was checked in
source; an actual iOS share sheet was not executed on Windows.

These three runs are a small behavioral pilot, not a reliability estimate or a
guarantee against future mistakes. Founder review and correction remain part of
the intended workflow. The fixed batch ended after the declared three attempts.
The runs cost 16 app credits in total. Temporary fixture registrations, seeded
setup routines, fixture servers and eval browser tabs were cleaned up.

## Validation

The skill validator and the repository skill-loader tests passed, as did
`npm run check` in every workspace. The workspace test command passed 238 API
assertions before a test process remained alive after `runs.test.ts`; continuing
from that file with `--test-force-exit` before the file arguments passed 82
assertions, zero failed (the ranges overlap). Other workspace tests completed:
desktop 116 passed and four skipped, connectors two passed, extension eight
passed. The original workspace command did not finish cleanly. Test source and
package scripts were unchanged.
