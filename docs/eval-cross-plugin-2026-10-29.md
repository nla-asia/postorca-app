# Media and Video pilots — 29 October 2026

Both cases used the shared external prepare/run/collect/review/triage lifecycle,
ordinary authenticated work tasks and their unchanged briefs. They ran once each
on the existing local gpt-6-luna build with its older compiled OpenAI media
provider configuration. These results do not establish current-source release
acceptance or repeated-run reliability. Private files and task details remain in
ignored `.data/evals/` in the shared-eval-runner worktree.

| Case | Acceptance | Agent time | Calls | Tool errors |
| --- | --- | ---: | ---: | ---: |
| Media M1 | Passed after independent review | 69.352 s | 13 | 0 |
| Video B3 | Blocked under policy 3; original policy-2 failure preserved | 298.687 s | 22 | 3 |

## Media M1

The agent created the square sprout illustration and exact requested speech,
then edited the original image reference to change the pot from terracotta to
blue. It delivered a separate image artifact and did not regenerate speech.
All seven mechanical checks and three semantic criteria passed.

Codex inspected both actual 1024×1024 PNGs: sprout, framing and cream background
were preserved, with no text. The owner listened to the complete saved MP3 and
confirmed the exact sentence and clear sound in the chat. This Codex session
cannot receive audio input; the review attributes that judgment to the owner.

After restarting the actual desktop and reopening the task, both image previews
rendered and the original speech played to its end without error. All three
retained downloads matched the production storage originals and independent fresh
authenticated downloads by SHA-256. No prompt change or paid retry was needed.

Attempt: `media-M1-52a90a26-934e-4dc3-9c8d-0ffba50c25fe`.

## Video B3 and its three separate causes

The agent created three candid workspace images, previewed and revised text,
and exported one 20-second, 1080×1920 H.264 MP4 at 30 fps. All 600 frames decoded
without error. Sampled output frames show the exact feature name, Monday summary,
waiting decisions and URL. The MP4's SHA-256 matches production storage and a
fresh authenticated download. These checks establish rendering and transport,
not full-motion or auditory quality.

Three distinct findings are retained:

- **Infrastructure:** ElevenLabs rejected narration with `quota_exceeded`. The
  final artifact is explicitly disclosed as a silent, text-led fallback; ffprobe
  confirms no audio stream. Narration and complete playback-with-sound acceptance
  remain blocked. Read-only catalogue preflight established access, not quota.
- **Agent:** one status call contained output fields instead of empty arguments;
  one image call contained speech arguments. Both were locally rejected, corrected
  and retained as real diagnostics. No case-specific prompt coaching was supplied.
- **Eval:** the style grader included the rejected speech-as-image call as if it
  had generated an image. The three successful generation prompts were candid
  smartphone photography. Filtering style evidence to successful calls fixes this
  false failure while preserving checks against every real generated image.

The correction is [grading policy 3](EVAL_FAILURE_POLICY.md). It requires an
explicit regrade and preserves the old failing judgment and triage. It does not
make B3 pass or remove the three tool errors. The case, launch record and raw
task evidence remain unchanged. No additional agent, speech, image or video
generation was used for the explicit regrade. Hash comparison confirmed that
`case.json`, `run.json` and raw `evidence.json` remained byte-for-byte unchanged.
The current result is **blocked**, with the original style failure and three-side
diagnosis preserved in history. M1 retains its original policy-2 approval; this
Video-only correction did not silently rewrite unrelated stored judgments.

The provider account needs quota or credits restored by its owner before a fresh
narration attempt. No automatic top-up or repeated paid speech request occurred.
Token and monetary metrics remain unavailable. Full playback/listening is still
required before a Video attempt can be accepted; sampled frames are not a pass.

Attempt: `video-B3-4317f63c-af68-4156-8135-f0e0bc308852`.
