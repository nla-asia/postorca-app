# Media and video verification

The original repository is the reference for these checks. Run each case once,
read the report, and inspect the retained evidence before starting another paid
case. Do not count a completed agent turn or a saved MP4 as quality acceptance.

## Order

1. `npm run media:smoke` — paid provider check: one low-quality square image,
   voice discovery, a short speech clip and transcription. Results are in
   `apps/api/.data/media-smoke/`.
2. `npm run video:eval -- M1` — real agent creation and image revision through
   a one-time Calendar task and Follow Up. Checks that image/audio artifacts
   persist, authenticated downloads match stored bytes, the revision edits the
   existing image, and the original stays available without regenerating speech.
3. `npm run video:eval -- B3` — product update; then `B5` — exact build-log
   figures; then `B7` — revision and two variations on the B5 work item.
4. Run further feature cases individually, as needed. Review portrait and
   landscape exports with complete playback and sound before accepting quality.

`npm run video:smoke` is the separate offline Electron renderer check. It uses
synthetic fixtures, exports all four formats and verifies the files with ffprobe.
It spends no provider/model credits and does not exercise agent judgment.

## Setup and commands

Keep the API, local database and signed-in desktop running. Set the conversation
model and the two media credentials in `apps/api/.env`; run the existing catalog
sync with `npm run db:migrate`. For several accounts, select the intended founder
with `POSTORCA_EVAL_EMAIL` or `POSTORCA_EVAL_USER_ID`. The runner refuses to start
while another agent turn is queued/running or the catalog is stale. The agent
checks desktop availability before making video assets.

```sh
npm run video:eval -- --list
npm run video:eval -- --preflight
npm run video:eval -- B5
npm run video:eval -- B5 --task <existing-task-id>
npm run video:eval -- --review
```

One case runs at a time, protected by `apps/api/.data/video-evals/running.lock`.
Do not remove a lock while its runner or task is active. A timeout has an unknown
outcome: inspect the saved task/schedule instead of creating a duplicate. `--task`
only scores existing work and makes no model or media requests. `--review`
collects the latest retained video files for convenient playback.

The video cases preserve the original IDs, facts, durations and expected skills:
B2/B3/B4/B5/B6/B7/B8/B11/B12/B13/B14, plus
F2/F3/F4/F9/F11/F10/F5/F6/F7. Screenshot and music cases require the real supplied
assets. Their paths resolve inside the founder's existing project folders; the
new app has no separately configured working folder, so music briefs name the
project folder. Do not fabricate replacements to pass these cases. F6 temporarily
clears profile colours and restores them when its run finishes.

## Evidence and grading

Each run retains its exact brief, task/turn IDs, commit and working-tree state,
model, platform, messages, artifact metadata, download checksums, tool calls,
errors, token counts, paid-call counts and elapsed time in
`apps/api/.data/video-evals/<case>-<time>/report.json` and `report.md`. Video exports
are copied alongside the report. Frames are extracted at the opening, one-third,
two-thirds and near the end.

Automated checks follow the original: expected exports, preview before export,
required skill, exact words/numbers, hook sticker, shot pacing, captions, brand
settings, supplied screenshots/music, duration and audio stream. They also check
actual artifact delivery and authenticated byte-for-byte downloads. A repeated
paid tool after a provider failure is flagged even when other steps intervene;
correcting a local argument rejection is distinguished from a billed retry.
Browser input is recorded conservatively; it alone is not proof of publishing.

Visual review must check the actual brief, image defects, exact readable text,
unobscured product controls, hook, relevant shots and caption timing. Full
playback with sound is needed for motion, pronunciation, voice quality and music
balance. Record what worked, what failed, the cause and the smallest justified
fix. Preserve failed runs. Never mark subjective acceptance from frame checks or
transcription alone. Music access failures recorded in the original repo are
historical; do not claim music works here until a fresh paid request passes.
