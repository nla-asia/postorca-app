# Content idea and code-to-script pilot — 2 November 2026

Two live cases ran once each on Windows with Meta `muse-spark-1.3`, through the
shared prepare/run/collect/review/triage lifecycle. These are single-run results,
not repeated-run reliability measurements. The API and desktop served the unchanged
product code at `7e27a1e`; the observer used the same base with the platform and
fixture changes in this pull request. Private task evidence remains in ignored
`.data/evals/` in the `platform-independent-content-evals` worktree.

| Case | Reviewed result | Agent time | Tool calls | Recovered errors | App credits |
| --- | --- | ---: | ---: | ---: | ---: |
| `ideas-tide-from-commits` | Failed grounding criterion | 42.7 s | 16 | 1 | 2 |
| `content-script-tide-intro` | Passed | 91.6 s | 29 | 1 | 5 |

## Readiness

Before either launch, the operator verified normal sign-in, completed onboarding,
the brand profile and selected account, the serving model, available credit
headroom, no active tasks, the desktop's actual project git access, the chosen
working folder, and the reloaded Edge extension. An actual browser open and
accessibility snapshot established that Tide was reachable. Its fixture prepared
and cleaned up successfully on Windows, and there was no prior work-ideas memory.
Cases ran sequentially. No credentials were minted, billing balances altered,
media produced, content published, or repeat paid attempts submitted.

## Ideas result

The routine proposed quick add first as a product demo and the two-tab overwrite
fix separately as a text post. It excluded the refactor and dependency bump.
The capture steps align with the code, including its automatic switch to Upcoming
after adding a task for tomorrow.

Four of five semantic criteria passed. Grounding failed because the text invented
a personal multi-tab habit for the founder and reduced a three-field form to an
unverified exact three-click claim. Those details are not established by the
opened source or notes. The missing `work-ideas.md` read was an expected first-run
condition that the agent recovered from; it remains a tool-error diagnostic.

Attempt: `ideas-tide-from-commits-506f906b-4581-40ed-b719-836338fab1d5`.

## Script result

The agent read the project and inspected the app, then delivered a five-shot,
16:9 script introducing Tide, showing quick-add parsing, checking a task off into
Completed, and finishing on Upcoming. All seven semantic criteria passed.
The 57 spoken words are approximately the requested 60–80-word range and fit
30 seconds; the plan's approximately 75-word estimate is inaccurate metadata.

Independent readback verified that the actual `plan.md` and `script.md` match the
saved tool text after the product's whitespace trimming. Copies and SHA-256
hashes are retained in the attempt's evidence. The agent recovered from one
rejected empty-string `browser_type` by clearing the input with keyboard keys.
The recovered error remains recorded and does not override the reviewed outcome.

Attempt: `content-script-tide-intro-b9db4d13-0fca-4e9c-a16a-7fdbd8f65897`.

## Cleanup and portability

Both fixture servers stopped. Eval browser tabs, the temporary project
registration, the routine seeded by adding that project, and the inactive eval
routine were removed. The newly created work-ideas memory was backed up privately
and restored to its original absent state. Deliverables and eval tasks were kept
for review. There were no active tasks at cleanup.

Eight script-only cases now have no OS gate; Quill retains its macOS gate because
its fixture launches a native Mac app. Recording and Simulator cases retain their
existing requirements. This pilot establishes live Windows execution for Tide,
not live coverage of every newly ungated case. Streaks separately passed a Windows
fixture prepare/observe/cleanup smoke check using the corrected filesystem path.

## Repository validation

`npm run check` passed in every workspace. The unmodified `npm test` passed 158
API assertions through the legacy-upgrade tests, then that test process remained
alive after its last assertion. The run was stopped and continued from
`legacy-upgrade.test.ts` through every remaining API file with the same runner
options plus Node's `--test-force-exit`: 157 passed, zero failed (three legacy
assertions overlap the first run). Other workspace tests completed normally:
desktop 116 passed and four skipped, connectors two passed, browser extension
eight passed. The targeted demo/catalog regression suite also passed all 11 tests.
The unmodified root command therefore did not finish cleanly; no test source or
package script was changed to conceal that limitation.
