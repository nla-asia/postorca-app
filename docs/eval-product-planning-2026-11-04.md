# Product planning script evals — 4 November 2026

The planning references are discoverable, but the current skill is not reliable enough
for recording. Eight script-only attempts across seven scenarios produced seven failed
reviews and one candidate awaiting the founder's voice/style judgment. This is a
small diagnostic batch, not a reliability estimate or a passing streak.

## What ran

All attempts ran through the existing eval CLI and normal content-task API, with
Orca on `muse-spark-1.3`. The serving API was temporarily switched to the
`feature/product-introduction-skill` worktree after checking there were no active
founder tasks. The desktop remained connected to the same local API and database.

The production skills stayed unchanged during the batch. All eight attempts froze
commit `0e7a3dd9a9dd756ba4a1c90f9e087d5e9de78fe5` plus the same eval-only working
changes, with fingerprint
`cb631e2906cf933adf04bf13c9efd9205397b863481c033e7b1d0b3abcb4e193`.
Tide and Ledgerly fixtures were independently prepared, observed unchanged and
cleaned before execution. Each attempt retained a real `desktop_status` readiness
result. Actual plans, scripts, tool evidence, review decisions and triage are in the
ignored local `.data/evals/<attempt-id>/` folders. Readiness check tasks were archived;
the eight eval tasks and all failed attempts were retained.

No recordings or generated media were produced. One unapproved speech-generation
attempt was rejected by the existing product guard. The normal main-checkout API was
restored afterward, with a successful health check, and the two temporary fixture
project registrations were removed.

## Results

| Scenario | Attempt suffix | Review | Main evidence |
| --- | --- | --- | --- |
| Tide intro, no screens — first run | `507f6bae-459e-4380-b773-1af18804b434` | Failed | Correct reference and type-only plan, but an unsupported absolute close: “No extra clicks.” |
| Ledgerly introduction | `f79b7a6d-2e32-409b-99df-dff9bf2d1a1d` | Failed | Planned UI without inspecting the running app; 23 words in a six-second product-definition shot. |
| Tide demo | `3655752a-c047-494f-98b4-a4820555882d` | Failed | Delivered document artifacts instead of the required file saves; never inspected the submitted-task result; overloaded a seven-second narration beat. |
| Ledgerly intro + demo | `55cb7f23-f6bf-4f78-a635-770fab0f195d` | Failed | Read both guides, but explicitly deferred inspection of the invoice detail/status-change beat until capture. Claimed 88 words versus about 68 actual words. |
| Ledgerly how-to | `297c9ae0-f8c7-43f8-839a-8e8e2bc6d3a5` | Failed | Direct, focused instructions, but the critical invoice detail screen was not reached. Tool limitations and the untried computer fallback are separately diagnosed. |
| Ledgerly feature release | `f2574c03-f87e-4697-b036-5c43428b3076` | Failed | Invented a founder anecdote, attempted speech before approval and compressed its opening narration. A separate first-shot naming criterion was an eval defect. |
| Ledgerly what's new | `64fef0bf-0d6a-4099-aa6e-946e11755ecd` | Failed | Uninspected PDF shot, narration about overdue invoices assigned to a revenue-chart shot, and unsupported “Live in Ledgerly now.” A separate fixed-shot/grouping failure was an eval defect. |
| Tide intro, no screens — second run | `6ac8a67a-1576-4554-bb4d-60ac5ba4a963` | Awaiting founder review | Correct reference, saved files, 68 spoken words with plausible timing, type/animation only, supported claims and no production attempt. |

All eight read the expected primary planning reference. The explicitly mixed case
also read the demo reference. This establishes reference discovery and basic routing;
it does not establish that the agent consistently follows all the guidance.

## The strongest candidate to review

The second Tide no-screen introduction is a useful founder-review sample. Its complete
script and shot plan are retained under:

`.data/script-eval-review/content-script-tide-intro-no-screens-6ac8a67a-1576-4554-bb4d-60ac5ba4a963/`

Its voiceover is:

> Too many tabs open, and your to-do list is just another noisy tab. Tide is a calm
> todo app for people with too many tabs open. Type one sentence — like Call Sam
> tomorrow at 3pm — and Tide reads the date, time, and project as you type. Today
> shows what's due, Upcoming shows what's next, with overdue clearly marked. Just
> what you need to do, nothing shouting for attention.

The repeated “too many tabs” phrase and the closing tone still need the founder's
judgment. This account supplied neither `voice.md` nor recent posts, so matching a
specific founder voice was not established. A technical review is not founder approval.

## Separate causes

### Agent behavior

- **Screen inspection is deferred.** Three Ledgerly plans explicitly say important
  screens will be checked during capture, despite already scripting those shots.
- **Timing is uneven.** Whole-script totals can look plausible while individual shots
  require about 3.6–4 words per second. Incorrect claimed counts also appear.
- **Claims drift.** Absolute convenience promises, an invented founder experience and
  unverified availability appear in public narration.
- **Stage discipline breaks.** The feature-release run loaded video production skills,
  then called `media_generate_speech` before saving/approval. The guard worked.
- **Deliverables are inconsistent.** The Tide demo created artifacts without saving
  `plan.md` and `script.md` using the available content-file tools.

The production skills were not rewritten during these runs. The next skill change
should address the demonstrated decision failures and competing planning/production
guidance, then be tested with fresh repeated attempts and held-out briefs.

### Tool/environment limitation

The Ledgerly invoice table has clickable rows, but those rows received no browser
snapshot refs. `browser_click` accepts refs, while `browser_open` always creates a
new tab. The new tab showed the sign-in screen because the fixture uses per-tab
`sessionStorage` for login. The how-to agent read `computer-use` but did not attempt
its control tools. It therefore did not establish whether that existing fallback
would work. This is not evidence that a new browser API or app architecture is needed.

### Eval defects and corrections

- The initial source-order check falsely treated an artifact-only draft as if no
  successful project read occurred. It now recognizes both saved files and document
  artifacts as draft boundaries, while retaining the independent missing-files
  failure. Regression tests cover successful, failed and late reads. The Tide demo
  was explicitly regraded with a reason; its original grading history remains.
- The frozen feature rubric required product/feature naming in the very first shot,
  conflicting with the feature reference's valid problem-first opening.
- The frozen what's-new rubric required fixed shot counts and one change per shot,
  conflicting with the reference's permission to group related changes.
- Generic demo briefs should not silently require one particular supported task.

Future script contracts are versioned as revision 3 for the original nine cases and
revision 2 for the six new scenarios. They remove those structural mismatches while
preserving truthful claims, meaningful task results, the requested format/duration,
inspection of any planned UI, required file saves and approval before production.
These revised contracts have unit/catalog validation; no new paid executions after
that measurement correction are claimed here. Frozen historical criteria were not
rewritten to turn a failure into a pass. Every failed review and retained tool error
has an evidence-bound triage record.

## Coverage and validation

There are now 15 script-only cases: the original nine plus Tide/Ledgerly demos,
Tide/Ledgerly mixes, Tide without product screens and Ledgerly payment-recording
how-to. This batch exercised all five reference types, plus a mix and the no-screen
constraint, across two web fixtures. Only the no-screen scenario was repeated.
Native Packlight/Quill behavior, founder voice matching and statistical consistency
remain unestablished. This batch does not evaluate finished video, capture or audio quality.

`npm run check` and `npm test` passed. The targeted computer-demo/shared-runner tests
also passed, including the new grader regression checks. No product routes, schemas,
migrations or persistence formats changed.
