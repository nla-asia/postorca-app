# External eval runner

The shared runner lives in `apps/api/src/evals/shared/` and is invoked with
`npm run eval -- ...`. It calls the existing product task API. It adds no product
routes, database tables, UI, or LLM-judge service. An external observer (Codex or
a person) reviews the actual evidence and records semantic judgments.

## Autopilot reuse assessment

Reference inspected: `D:/www/autopilot/autopilot-backend`.

| Autopilot source | Decision in PostOrca |
| --- | --- |
| `docs/guides/EVAL_CREATION_GUIDE.md` | Reuse the separation of real user assignments, hidden expectations, fixtures, trajectory assertions, and semantic review. Preserve failures; distinguish evaluator/environment defects from agent failures. |
| `src/models/Eval.ts` | Adapt its task, grading mode, fixture, and criterion concepts to versioned local case JSON. No eval database. |
| `src/eval/programmatic_judge.ts` | Adapt required/alternative/forbidden tool assertions, argument/result matchers, and explicit call/error budgets into a pure evidence grader. No repository imports. All required checks must pass; no percentage threshold can hide a failed requirement. |
| `src/eval/eval_judge.ts` | Reuse separate programmatic and semantic results and hybrid acceptance. Replace the judge API call with a recorded external review. |
| `src/eval/cli_browser_eval_judge.ts` | Reuse independent outcome verification as a principle. Case verifier scripts inspect fixture events, native observations, or actual output files rather than trusting the final answer. |
| `src/eval/eval_fixture_service.ts` | Adapt checksum-pinned inputs and prepare/observe/cleanup lifecycle to external commands. Leave S3 signing, Electron fixture transport, and Autopilot infrastructure behind. |
| `src/eval/eval_runner.ts` | Reuse attempt history and repeated-run reporting concepts. Leave its agent factory, application repositories, training UI, and database machinery behind. |

Nothing imports the sibling Autopilot checkout at runtime. Existing source fixture
directories are not automatically trusted as the published checksum-pinned archive.

## One lifecycle

1. `prepare` freezes the complete case, resolved brief parameters, observer readiness,
   model declaration, Git commit/dirty state, and a content fingerprint of tracked
   and non-ignored local files. No product task or paid call is started.
2. `run` verifies readiness and fixture pins, then prepares the fixture. It creates
   a normal `work` task and submits only the user briefs. It collects each turn
   before advancing. A failed turn or tool error stops paid follow-ups.
3. The runner collects the real task, tool calls/results, media artifacts and tool
   screenshots. Authenticated file downloads are retained with byte counts and
   SHA-256. This establishes downloaded bytes; equality to original provider/source
   bytes requires a separate verifier or review with independent source evidence.
4. Fixture observation happens after execution and before cleanup. A verifier can
   inspect the retained evidence. Fixture cleanup runs even after setup/observer
   failures where execution is known to have settled.
5. `inspect`/`regrade` computes programmatic checks and writes a review template.
6. The observer inspects the original request and actual deliverables, completes
   each required review item, and submits it with `review`.
7. `report` shows every attempt, counts by verdict, and the current passing streak,
   grouped by case, frozen contract, and runtime fingerprint.

Programmatic, `llm` (external semantic review), and hybrid modes share this lifecycle.
Execution completion and outcome acceptance are separate. Overall verdicts are
`passed`, `failed`, `blocked`, or `awaiting_review`. Deterministic failures cannot
be overridden by a semantic pass. Missing evidence is not acceptance.

## Commands

Run from the repository root. Paths passed to the CLI resolve from the invoking
directory, including when npm forwards to the API workspace.

```sh
npm run eval -- list
npm run eval -- list browser
npm run eval -- prepare browser-x-post-research --config .data/eval-config.json
npm run eval -- run <attempt-id>
npm run eval -- inspect <attempt-id>
npm run eval -- collect <attempt-id>
npm run eval -- review <attempt-id> --review .data/completed-review.json
npm run eval -- regrade <attempt-id> --reason "Evidence-based grader correction"
npm run eval -- triage <attempt-id> --triage .data/diagnosis.json
npm run eval -- report
npm run eval -- benchmark --out .data/benchmark.html
```

`POSTORCA_EVAL_API` defaults to `http://127.0.0.1:3001/api`.
`POSTORCA_EVAL_TOKEN` must contain an existing founder session token; obtain it
through the normal sign-in flow. The runner does not mint credentials or bypass
authentication. Tokens are never written into attempt records or command arguments.
Hook processes do not inherit this token.

Example ignored observer config:

```json
{
  "model": "the-actual-configured-agent-model",
  "parameters": { "topic or product": "Claude Code" },
  "readiness": {
    "browser_connected": {
      "reason": "Independently checked the signed-in desktop and connected browser extension.",
      "checked_at": "2026-10-28T20:00:00+07:00"
    }
  }
}
```

Readiness checks must be at most five minutes old at first launch. Supply every
prerequisite listed by `list`. This timestamp is an example, not a ready-to-use
attestation. The model is operator-declared: confirm the actual server model and
matching deployed checkout before preparing. A local fingerprint does not prove
the version of a remote server. The runner records these limits rather than
claiming remote runtime attestation.

Brief placeholders must be supplied explicitly (`departure date`, `return date`,
`Bangkok neighborhood`, `date`, etc.). Research windows anchor to the recorded
launch time; review publication dates against that timestamp. Frozen briefs are
never rewritten between attempts to turn a prior failure into a pass.

## Evidence and review

Default storage is ignored `.data/evals/<attempt-id>/`:

```text
case.json                 frozen assignment, expectations, hooks and fixture pins
run.json                  execution state, task/turn launch intents and IDs
events/                   atomic timestamped lifecycle records
evidence.json             full task, normalized calls, downloaded-file manifest
evidence/                 original media bytes, fixture observations, verifier output
result.json               programmatic checks, semantic checks and combined verdict
review-template.json      required semantic items and frozen evidence/case hashes
review.json               accepted observer identity, reasoning and evidence references
triage-template.json      failure/blocker/tool-error issues awaiting root-cause investigation
triage.json               evidence-bound agent/infrastructure/eval findings and next actions
history/                  previous grading results and reviews
```

Copy `review-template.json` outside the attempt, set `reviewer` (for example
`Codex, <actual model/version>`), then fill every criterion's verdict, reasoning
and evidence references. References are attempt-relative files with optional JSON
pointers, e.g. `evidence.json#/task/turns/0/messages/4` or
`evidence/<downloaded-video>.mp4`. They must exist and stay inside the attempt.
The template contains instructions to assess, not a prefilled approval.

Only mark `passed` after inspecting the relevant evidence. Video motion and sound
require actual playback; transcription or sampled frames alone cannot establish
listening quality. Use `blocked` or `awaiting_review` when inspection is unavailable.
The CLI validates complete coverage and evidence references, not whether an
observer actually watched/listened. That remains the observer's responsibility.

Reviews bind to the frozen case, programmatic grading output and hashes of all
retained evidence. New collection, changed media/observations, or changed checks
invalidate the prior approval. Changing grading policy requires an explicit
regrade reason; inspect/report retain older stored judgments and flag the required
regrade instead of silently applying a new policy. Regrading archives the old result; it never starts
another product task, model call, fixture, or paid generation.

Execution, acceptance, and root-cause diagnosis are separate. Recovered tool
errors remain measured and require investigation but do not universally fail an
otherwise completed task. Explicit case error budgets still apply. See the
[failure investigation policy](EVAL_FAILURE_POLICY.md) for the three causes,
mixed/unknown diagnoses, correction safeguards, and the versioned download-case
correction. Triage cannot override a verdict or erase a frozen criterion.

Tool counts and failures are measured. Model token totals and monetary cost are
currently reported as `null`, not zero: the task API does not expose a complete
usage ledger. Live ledger/trace collection is a separate adapter still to add.
The wall-clock limit is an observer timeout, not product cancellation. Tool-call
budgets are grading requirements, not injected changes to the product agent loop.

## Fixtures and programmatic verification

Supply `fixture` and/or `verifier` in the observer config. Every command has:

```json
{
  "executable": "absolute-path-to-node",
  "args": ["absolute-path-to-observer-script.mjs", "prepare"],
  "timeout_ms": 60000
}
```

The runner appends the absolute attempt folder as the final argument and invokes
the executable directly, without a shell. Hooks are trusted observer code. They
must emit one JSON object on stdout and send logs to stderr. Output is saved in
`evidence/fixture-prepare.json`, `fixture-observe.json`, `fixture-cleanup.json`, or
`verifier.json`. Nonzero exit, invalid JSON, or timeout is an observer/environment
failure and cannot become an accepted agent outcome.

```json
{
  "fixture": {
    "files": [{ "path": "/absolute/input-or-bundle.zip", "sha256": "64-lowercase-hex-digits" }],
    "prepare": { "executable": "/absolute/node", "args": ["/absolute/fixture.mjs", "prepare"] },
    "observe": { "executable": "/absolute/node", "args": ["/absolute/fixture.mjs", "observe"] },
    "cleanup": { "executable": "/absolute/node", "args": ["/absolute/fixture.mjs", "cleanup"] }
  },
  "verifier": { "executable": "/absolute/node", "args": ["/absolute/verify.mjs"] }
}
```

Pin all fixture inputs and external observer scripts in `files`; repository scripts
are also covered by the runtime fingerprint. Setup should copy/extract into an
attempt-owned workspace, reset deterministic state, start the production fixture,
and health-check it. Save process/resource ownership before performing setup so
cleanup can handle partial failure. Cleanup must be idempotent and affect only
resources owned by this attempt. Observation must read actual fixture events or
state without completing the agent's missing work.

Verifier output:

```json
{
  "checks": [{
    "id": "quote-total",
    "verdict": "passed",
    "reason": "Independent fixture event has quantity 3 and total USD 62.75.",
    "evidence": ["evidence/fixture-observe.json#/quote"]
  }]
}
```

Fixture commands are extension points, not automatic imports of every Autopilot
site; each fixture still needs its actual startup/reset/observation adapter.

### Development desktop Computer observer

`scripts/evals/observe-computer.mjs` supplies a read-only verifier for the existing
Computer graders. Start the executing development Electron desktop with a
temporary loopback main-process inspector, for example `--inspect=127.0.0.1:9232`.
Use the absolute `apps/desktop` directory belonging to that executing desktop,
which may differ from the runner's worktree. Before preparing an attempt, run:

```sh
node scripts/evals/observe-computer.mjs --desktop-root /absolute/apps/desktop --inspector http://127.0.0.1:9232 --preflight
```

This checks the actual loaded controller is available and inactive and the native
helper can list applications. Also verify API health, the normal authenticated
session, and the desktop's connection to that API. Record fresh
`desktop_connected` and `independent_observer_ready` readiness evidence. Configure:

```json
{
  "verifier": {
    "executable": "/absolute/node",
    "args": [
      "/absolute/scripts/evals/observe-computer.mjs",
      "--desktop-root", "/absolute/apps/desktop",
      "--inspector", "http://127.0.0.1:9232"
    ],
    "timeout_ms": 60000
  }
}
```

After the product task settles, the observer reads the last successful native
window from the actual tool evidence, verifies its process identity, reads its
Accessibility tree, and saves `evidence/computer-observer.png`. It reads controller
status before and after observation to establish release. It never opens an app,
enters input, or reads the expected answer. The inspector adapter refuses unloaded
modules: creating a fresh idle controller would falsely establish release.

Inspect the original agent screenshot artifact as well as this independent
readback. Do not overlap desktop work or change its windows during observation.
This adapter was exercised on Windows with the development desktop; it does not
establish packaged-desktop or macOS parity. Once all work and observation have
settled, restart the owned development desktop without its temporary debug ports.

For custom cases, supply the complete `case` object in the config with its ID,
plugin, title, turns, grading mode, semantic criteria and trajectory assertions.
Matcher operators mirror Autopilot: `equals`, `contains`, `regex`, `exists`,
`starts_with`, `includes_any`, `array_min_length`, `min`. Dotted/indexed argument
and result paths are supported. Forbidden calls count failed attempts too.
Required calls default to successful calls. Budgets count individual calls,
never model responses. Prefer result assertions and independent outcome verifiers
over merely asserting that a tool was invoked.

## Existing case migration

All 29 agent cases are registered: Browser 5, Computer 8, Media 5, Writing 4,
Ideas 3, Content 4.

### Categories

The case's `plugin` field holds its category; `npm run eval -- list writing` lists one.
Case IDs stay stable when a case changes category. Browser, Computer, Media and
Writing each have a level 1 tool check and level 2 process cases; Ideas and Content
have only level 3.

| Category | Question | Level 1 | Level 2 |
| --- | --- | --- | --- |
| Browser | Can Orca browse and research? | `browser-tools`: every browser tool on Wikipedia | X, LinkedIn and Instagram post research (Threads waits for an account); `browser-find-music`: find and save a free, usable track |
| Computer | Can Orca control apps and record clips? | Calculator, Notepad, Edge, Mac Calculator | 4 demo-recording cases |
| Media | Can Orca make and edit images, audio and video? | `media-M1`: every media tool except music (out of scope: the key has no access); speech and transcription check each other | Video F3 (music under voiceover), F6 (no brand colours); `media-quote-card` (square, then portrait edited from it); `media-checked-voiceover` (transcribe the final take; every fact kept) |
| Writing | Does Orca write like the founder? | `writing-tools`: document, in-place edit, reply, saved posts | post, reply, revision |
| Ideas | Do the idea routines find things worth posting? | level 3 only: daily content ideas, ideas from your work, weekly strategy research, each run as a real routine | |
| Content | Can Orca do the founder's whole job, end to end? | level 3 only: product demo videos of a Mac app, an iOS app in the Simulator, and what the founder just shipped (work fixture); `content-reel-with-music`: a reel with music found online | |

Writing level 2 cases need the founder's real brand profile (`brand_profile_ready`):
programmatic checks cover platform format, supplied facts, placeholders and in-place
revision, and the reviewer judges voice. Speech uses ElevenLabs library voices;
PostOrca does not clone the founder's own voice. The writing grader can also require research
before writing and a generated image, for Content cases to use.

### Ideas: real routine runs

An Ideas case has a `routine` and one turn, its instructions (the same as the default
routine, naming its skill). `run` creates an inactive routine on that platform and
starts it with Run now (`POST /routines/:id/run`), so the product submits the turn
itself with no one in the chat; the attempt then follows that task like any other.
The routine stays inactive afterwards. Supply `account` and `account url` parameters.

### Music fixture

When a case tests mixing rather than finding music, the track is a fixture.
`fixtures/evals/music/` holds the pinned tracks (source and license in its README);
`scripts/evals/music-fixture.mjs` copies the track into the founder's working folder
(`eval-fixtures/`, override with `POSTORCA_WORKING_FOLDER`) before `video-F3` and removes
it afterwards, refusing to overwrite a file it did not create. Finding music online is
tested on its own in `browser-find-music` and end to end in `content-reel-with-music`.

### Work fixture

`scripts/evals/work-fixture.mjs` rebuilds a small web app, Streaks, as a git
repository at `~/PostOrca Evals/streaks` for `ideas-work-ideas` and
`content-demo-work-video`. Its older history is ten days old; the recent work, a few
hours old, is a timezone bug fix with a surprising cause (UTC dates reset streaks
for testers in Asia) and a visible feature (a weekly recap card), with beta notes.
`prepare` refuses a folder it did not create and a busy port, then serves the app at
`http://127.0.0.1:4110`; `observe` reports whether the agent changed the repo (a
failed `fixture-unchanged` check); `cleanup` stops only the server it started.

Before the first run, add `~/PostOrca Evals/streaks` to the founder's Brand Profile
projects (`work_fixture_project_added`). The work-ideas routine remembers moments it
already used, so clear those from its `work-ideas.md` memory before each attempt
(`work_ideas_memory_cleared`).

### Product-demo cases (Computer level 2, Content level 3)

`apps/api/src/evals/computer-demo-cases.ts` uses built-in apps as the founder's
product: Mac Maps and Clock, and Reminders and Maps on an iPhone in the iOS
Simulator. Anything that writes data runs in the Simulator, because Mac Notes,
Reminders and Calendar sync to iCloud. Boot an iPhone in the Simulator before a
Simulator case, and grant the desktop app Screen Recording permission for the Mac
apps.

Programmatic checks come from the product task: the app was opened, the screen was
checked before recording, enough clips were recorded with the app in use, and the
requested text was typed in the app (on or off camera: product-demo-capture sets the
stage before recording). Level 2 requires the clips as video artifacts; the
Content demo videos require a narrated `video_export` built from those clips, plus
the standard video checks. Clip quality and the app's final state are reviewed by the observer; these
cases need no native observer hook.
There is no special three-case browser allowlist.

- Browser cases retain their original success contracts for external review.
  Fixture cases require pinned lifecycle hooks before execution. They are not
  automatically programmatically graded merely because a definition exists.
- Computer cases reuse their existing deterministic graders and freeze their
  original expected values. Configure a `verifier` that returns
  `computer_evidence: { observed: <native observer readback>, controlReleased: true }`
  alongside optional `checks`. The grader gets calls, final text and artifacts
  from the product task, never from observer-supplied replacements. A missing
  computer observer blocks launch; the legacy standalone runners still provide
  the existing native observer/desktop bridge implementations as references.
  The development desktop adapter above is available for Windows live pilots.
- Video cases reuse `gradeVideo` with frozen expectations, plus required external
  inspection of actual media properties and complete playback. B7 creates a fresh
  B5 parent and runs its two follow-ups in the same task. Export counts and
  expectations are checked separately for each turn.
- Media M1 checks image creation, speech creation, real image editing and speech
  reuse; visual/listening quality, persistence and original-source equality remain
  explicit external review requirements.
- F6 requires the observer's empty-colour setup and restoration plan. Supplied
  screenshot/music cases require their actual assets. Do not fabricate substitutes.

The shared runner uses normal work tasks. Calendar scheduling coverage from the
legacy media/video runner is separate. Provider smoke checks and renderer unit
checks also remain separate; they are not agent-eval successes. Legacy entry points
remain available for historical evidence/native harness compatibility while live
parity is established. New work should use the shared runner.

Some inherited briefs explicitly describe temporary checks or prescribe tools.
They are preserved for migration continuity; do not describe those historical
contracts as uncoached natural-work baselines. New L2/L3 briefs should be ordinary
user assignments without evaluation language or hidden answer leakage.

## Interrupted work and repeatability

The runner writes task/turn launch intent before submitting. An uncertain response
never triggers an automatic repeat. `run <same-attempt>` resumes an existing task
and reconciles an uncertain turn from the real user message. If task creation's
response was lost, independently find the existing task, then use:

```sh
npm run eval -- reconcile-task <attempt-id> --task <existing-task-id>
npm run eval -- run <attempt-id>
```

An active-attempt lock prevents a new attempt from overlapping unresolved work.
A process writer lock prevents simultaneous resumes. After a process crash,
`recover-writer <attempt-id>` removes only a lock whose recorded process is dead;
it does not release the unresolved execution's ownership. Never manually delete
an active lock to start another paid run.

After observer timeout the fixture is retained because product work may still be
running. Collect/inspect the existing task and resume this attempt once its state
is understood. The original timeout deadline does not reset on resume. Settled
observer failures remain blocked in the report; fix the defect and prepare a new
attempt after cleanup. Failed attempts remain part of the history.

If cleanup itself failed, use `cleanup <attempt-id>` to retry it. The runner first
confirms that no product turn is active and refuses cleanup of an unresolved task
creation. This releases ownership only after cleanup succeeds; it does not turn
an incomplete or blocked attempt into a pass.

For repeated runs, prepare and execute individual fresh attempts using the same
contract, parameters and runtime. Inspect each result before another paid run.
`report` groups by grading-policy version as well as frozen contract/runtime, and
gives every attempt and the current consecutive passing streak; failures,
blocked attempts and unreviewed attempts reset the streak. No batch command
automatically chains paid runs before required independent review.

## Model benchmark

`benchmark` compares models from the stored attempts. It reads `case.json`,
`run.json` and `result.json` and never regrades or writes into an attempt.

```sh
npm run eval -- benchmark --out .data/benchmark.html   # or .md; JSON goes to stdout
npm run eval -- benchmark --plan luna-writing --out .data/luna-writing.md
```

The scoreboard opens with one row per category (over all its levels) and one
column per model, showing the pass rate. Click a category (or "Expand all") for its
levels and cases, each with the current passing streak, the median time and tool
calls over graded attempts, and what wasn't counted. The Markdown version puts the
same details in collapsed `<details>` blocks. The JSON keeps every category, level
and case.

- **Pass rate** = passes / (passes + agent failures + untriaged failures). A failure
  is the agent's when any triage finding on the agent side covers a failed or
  blocked check. Recovered tool errors alone don't make it the agent's.
- Eval-defect and infrastructure failures, blocked, unreviewed and stale attempts
  are shown in the cell ("not counted") but left out of the pass rate and streak:
  they say nothing about the model. An untriaged failure counts against it until
  it is triaged.
- **Stale**: the result's grading policy, case or evidence changed since grading.
  Run `inspect`/`regrade` on the attempt to count it again.
- A model **leads** a row (highlighted, and listed under "Where each model is
  stronger") when it and at least one other model have 3 or more scored attempts
  there and its pass rate is strictly the highest.
- Cost stays empty until the runner records it (see Evidence and review).

### Running the same cases on another model

The model is chosen only in `apps/api/src/settings.ts` (`settings.orca`); keys never
choose it. The API reports the model it serves at `/api/health` (`orca`), and `run`
refuses an attempt whose declared model differs, so an attempt can't be recorded
under the wrong model. To benchmark a model:

1. Make a plan: the cases (ids, categories or `level-N`, comma-separated) and how
   many attempts each gets.
   ```sh
   npm run eval -- benchmark-plan luna-writing --model gpt-6-luna --cases writing --repeats 3
   ```
2. Switch the serving model: set `settings.orca` to
   `{ provider: "openai", model: "gpt-6-luna" }` in the checkout the local API runs
   from, without committing it. Only priced models start. Restarting the API fails
   running Orca turns, so wait until none are queued or running. Check
   `curl -s http://127.0.0.1:3001/api/health` shows the model.
3. Set `"model": "gpt-6-luna"` in the observer config, then repeat for each attempt:
   ```sh
   npm run eval -- benchmark-next luna-writing --config .data/eval-config.json
   npm run eval -- run <attempt-id>
   # review and triage the result as usual
   ```
   `benchmark-next` prepares the case with the fewest attempts in the plan. It
   refuses while the previous attempt is unrun or awaiting review, and when the
   config or this checkout's `settings.orca` names another model. Paid runs are
   never chained unseen. Refresh the config's readiness checks before each run.
4. When the plan reports `done`, put `settings.orca` back, restart the API, and run
   `benchmark`. Plans live in `.data/evals/benchmarks/<name>.json`.

## Validation

`apps/api/tests/shared-eval.test.ts` exercises the shared lifecycle with a simulated
product transport and real observer subprocesses: lost responses, duplication
prevention, prerequisite/fixture failures, follow-up stopping, pending/invalidated
reviews, evidence references, fixture cleanup and retained timeout ownership.
These are runner checks, not claims that live PostOrca agent cases passed.
`apps/desktop/electron/eval-observer.test.cjs` covers native readback, incorrect
answer preservation, active control, missing/truncated evidence and inspector
operation/endpoint restrictions without operating the desktop.
