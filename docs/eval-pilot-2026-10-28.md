# Shared runner live pilots — 28 October 2026

Two real work tasks ran through the shared external CLI with the existing signed-in
founder session. The runner submitted the original frozen briefs; no mid-run
coaching or observer completion of the assigned work occurred. Separate source
checks, desktop UI review, and transport controls followed execution.

| Case | Outcome | Elapsed | Tool calls | Tool errors |
| --- | --- | ---: | ---: | ---: |
| `browser-notebook-quote` | Passed after independent review | 111.969 s | 14 | 0 |
| `browser-downloads` | Failed; original attempt retained | 36.724 s | 11 | 1 |

## Runtime and limits

The target was the already-running local API at `127.0.0.1:3001`, using
`gpt-6-luna`, the existing compiled desktop renderer, and the founder's real Edge
extension. This API build uses the older OpenAI-provider configuration, rather
than the current source checkout's Meta settings. Each attempt retains a separate
target-runtime manifest with compiled-file hashes. These pilots establish runner
compatibility with that observed build; they are not current-source application
release acceptance or a repeatability score.

The API's old desktop session had expired. The owner signed in normally before
launch. No replacement account, minted token, fixture answer, or grading rubric
was supplied to the agent. Tokens were passed in process environment only.

## Notebook quote

Added a checksum-pinned deterministic fixture adapter, `scripts/evals/notebook-fixture.mjs`.
Its lifecycle starts fresh state, observes actual POST events, and stops only the
server matching the attempt's ownership nonce. A separate fixture self-check
verified rejection of invalid quantities and correct quantity-dependent totals
before the agent attempt; that check is not counted as an agent success.

The live agent entered quantity 3, submitted the quote, captured a screenshot,
closed its owned tab, and delivered a document and an image artifact. The
independent fixture event recorded subtotal USD 58.50, shipping USD 4.25, and total
USD 62.75. The existing verifier passed its five checks. The screenshot visibly
contains all requested figures, and both final-answer artifact links were opened
and checked in the actual desktop app. All twelve combined checks passed.

The run correctly remained `awaiting_review` until the external observer submitted
the complete evidence-bound review. Fixture cleanup completed and the runner
released ownership before the second attempt started.

## Public-file downloads

All three originals were retained and authenticated retrieval succeeded. Separate
observer downloads matched each saved file's SHA-256 and byte count: W3C PNG
1,848 bytes; sample MP3 52,079 bytes; TypeScript licence 9,197 bytes. The W3C and
sample-audio URLs redirected; final source URLs were retained. The logo displayed
in the app, and the audio player reached its 3.195646-second end without a media
error. The licence bytes contain the actual Apache text, not a GitHub HTML page.

The case still failed:

- The trajectory contains no browser-open, observation, or session-transfer calls.
  The agent constructed a raw GitHub URL and downloaded it directly. Activating
  the browser plugin at the end does not meet the frozen browser-discovery criterion.
- Reading the downloaded licence through `read_file` was rejected because its
  Downloads location is outside the configured working/project folders. The error
  remains in the evidence. The agent substituted a raw-source URL artifact; it did
  not provide a final link to the retained licence attachment. Original bytes
  were nevertheless present in the task's download attachment and server storage.

Separate scripted transport controls passed 4/4 on the target desktop checkout,
including redirect preservation, HTTP/size/partial/abort rejection, and HTML-page
rejection for non-HTML filenames. Observer and target file-transfer implementations
differ, so the target's own controls were run and retained separately. These
scripted checks do not establish autonomous browser-session transfer.

The product turn completed, while the runner's strict tool-error policy recorded
the attempt as failed. Independent semantic review also failed the missing
browser-discovery criterion, so the failed outcome does not depend solely on
that policy. No coached retry or third paid attempt was started.

## Evidence and validation

Private task details, source bytes, original screenshots, UI observations,
judgments and transport logs remain in ignored `.data/evals/`. The local
`.data/live-evals/report.json` reports one accepted attempt and one failed attempt.
Neither history was rewritten to create a passing result. No UI Approve action
was taken; both work items remain in Inbox for the owner.

After the fixture addition, `npm run check` and `npm test` passed. The independent
fixture self-check and target transport controls also passed. Token and cost
metrics remain explicitly unavailable in the shared report.

## Subsequent investigation — 29 October 2026

The [failure investigation policy](EVAL_FAILURE_POLICY.md) separates product
execution, outcome acceptance, and root cause. The original download rubric's
hidden browser-discovery restriction was identified as an eval-design defect;
the file-access error remains a real agent action-selection mistake. Neither
finding indicates an execution-infrastructure failure in these pilots.

Explicit policy-2 regrading corrected the recovered-error execution label without
editing either frozen case, launch record, or raw task evidence. Original
judgments remain in history. Retained semantic judgments were revalidated against
the same evidence and frozen criteria: notebook passed, original download case
still failed. Its triage record identifies the two separate causes. Future
public-download contracts are revision 2; genuine session-transfer coverage is
preserved in the existing protected-resource case. No prompt change or new paid
attempt was used to manufacture a passing result.

## Cross-plugin Computer pilot — 29 October 2026

The unchanged `computer-calculator` case ran once through the same shared
prepare/run/collect/verifier/grading lifecycle. It passed all 13 checks in
113.979 seconds, with 23 tool calls and zero tool errors. The agent discovered
and opened Calculator, entered `37 × 24 + 19`, delivered its screenshot artifact,
and left the app displaying **907**. Both the delivered screenshot and the
independent observer screenshot were inspected and show `888 + 19 = 907`.

The new external `observe-computer.mjs` adapter read native Accessibility
(`Display is 907`) from the actual window and checked the already-loaded desktop
controller before and after observation: available, inactive, control released.
It supplied no input and no expected answer. The original brief, deterministic
grader and product prompts were unchanged. There was no retry or regrade.

Preflight first found the existing local database was stopped, making API health
return HTTP 500. This was an infrastructure prerequisite failure before any agent
request. Restarting the existing persistent local database restored health; no
database reset, schema change or authentication bypass was used. The signed-in
session and connected desktop were then verified before preparing the attempt.

This pilot used the same older local `gpt-6-luna` API build described above, on
Windows. Its target-runtime manifest records the executing desktop's source
hashes separately from the runner worktree. Evidence remains in ignored
`.data/evals/computer-calculator-746040b1-c440-4998-a04b-d3ea4e5aa5e2/`.
This is one successful Computer case alongside the two Browser pilots, not a
repeatability result or evidence that all Computer cases pass. Media and Video
still need live pilots through the shared lifecycle.

Validation on the latest develop base: `npm run check` passed. Browser-extension
tests passed 11/11, connector-service tests 2/2, and desktop tests 85 passed with
3 existing platform skips, including all four new observer tests. Ordinary
`npm test` stalled after successful assertions in the existing API connector and
plugin files; the stuck test processes were stopped, so that command is not
reported as passing. A separate full API run with Node's `--test-force-exit`
completed 260/260 assertions with no failures or skips. That diagnostic option
does not resolve the ordinary command's exit hang. The follow-up PR remains draft
with this validation limitation recorded; no test script was changed to hide it.
