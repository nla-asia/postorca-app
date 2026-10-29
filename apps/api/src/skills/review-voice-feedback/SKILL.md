---
name: review-voice-feedback
description: Once a day, judge what the founder asked to change in the last 24 hours of content tasks against what memory already knows about their voice, and update voice.md only with lasting lessons. Most messages are not lessons.
---

# Review voice feedback

Learn the founder's voice from how they correct drafts. During the day, Orca only changes the draft it is asked to change; this review decides, with the whole day in view and against what memory already holds, what is worth keeping. This is read-only work on tasks: never edit drafts, start tasks or post.

The job is judgment, not collection. Most of what a founder says about a draft is about that draft: a fact, a detail, a mood, a launch-day push. Saving those makes voice.md noisy and makes later drafts worse, because every draft follows it. A lesson is worth saving only when you would bet it holds for their next post on a different topic. When in doubt, don't save it to voice.md; keep it as a signal (see Memory) and let a later day decide.

## Process

1. **Read what is already known.** voice.md is in your instructions: its Picks, Variables, Never does, Habits we don't fix, Platform differences and Rules from edits. Read `voice-review.md` from memory (see Memory) for the signals earlier reviews held back. Call `list_my_posts` once (limit 20) to see how the founder actually writes.
2. **Read the feedback.** Call `list_content_feedback` (default: the last 24 hours). Messages at or before the Last review time in `voice-review.md` were judged already: skip them, so nothing counts twice. If nothing new is left, end with one line saying there was no feedback to learn from, and change nothing except Last review.
3. **Judge each message** (see Judging). Each one ends as exactly one of: a lesson, more evidence for something already known, a signal to hold, or nothing.
4. **Decide against memory** (see Deciding). Fold messages that say the same thing, in one task or several, into one item first.
5. **Save** voice.md with `save_memory` edits in its layout, changing only what the decisions touch, and update Confidence with today's date. Save `voice-review.md`. If voice.md doesn't exist yet, create it with the full layout.
6. **Finish** (see Finish).

## Judging

Read `references/judging.md` with `read_skill` for worked examples before judging. Ask these of every message, in order, and stop at the first that settles it:

1. **Is it about how the post sounds or is shaped?** Length, line breaks, lists or threads, how it opens or ends, tone, confidence, humor, wording, punctuation, capitalization, emojis, hashtags, words they don't use. Facts, numbers, names, links, dates, answers to placeholder questions, the topic or angle, variations, scheduling, publishing and images are not voice: nothing.
2. **Is it about this post only?** Words like "this one", "here", "for the launch", "since it's about X", or a change tied to the topic ("mention the price here") make it a one-off: nothing. A change that would make sense on a post about anything else may be a lesson.
3. **How strong is it?**
   - **Stated as a standing preference** ("I never use emojis", "always keep it under two lines", "I hate ending on questions"): a lesson, strong.
   - **A clear, specific correction** with no sign it's a one-off ("cut the second line, it's too long", "don't use 'used to'"): a lesson, weak.
   - **Vague or a mood** ("meh", "make it better", "not quite", "punchier?"): there's nothing specific to learn. Hold it as a signal only when it points somewhere specific ("too stiff" is a direction; "meh" is not); otherwise nothing.
4. **Is it Orca's mistake rather than a new preference?** If voice.md already says it (a Rule, Never does, a Variable or a Pick) and the founder asked because the draft broke it, it isn't new: it's more evidence for the existing entry, and the summary must say the draft broke it.
5. **Does it fit how they really write?** Compare with their posts. A correction their own posts contradict (they ask for no emojis on X, but their X posts use them) is still their wish for drafts, but keep it to the platform and context it came from, and mention the difference in the summary.

## Deciding

Compare each item with voice.md and the held signals:

- **Already in voice.md as a Rule, Never does entry, or Variable that says the same:** don't add an entry. For a Rule, raise its count and date. If the draft broke it, say so in the summary.
- **Matches a Note:** make it a Rule (edit the entry in place, raise its count) when today's evidence comes from a different day than the note, or from two or more tasks today. Update the Variable or Never does line it belongs to so the rest of voice.md agrees.
- **Matches a held signal** in `voice-review.md`: two signals in the same direction on different days are a weak lesson: add a Note and remove the signal.
- **New, strong:** add a Rule straight away, and update its Variable or Never does line.
- **New, weak:** add a Note.
- **New signal:** add it to `voice-review.md`, not voice.md.
- **Contradicts voice.md:** a newer strong lesson, or a weak one seen on two days, replaces the old entry (rewrite it; don't keep both), including a Pick it overrides (keep the Pick, add that their edits now say otherwise). A single weak one is held as a signal and named in the summary.

Every entry under Rules from edits is one general instruction for future posts, with the date, the platform (or "all" when it came from several), the founder's words quoted short, and the count. Keep the list short: merge entries that say the same, and remove a Note that has not been seen again in 30 days (move it to the signals instead).

## Memory

`voice-review.md`, with the description "Voice signals the daily review held back, and when it last ran". Two parts, in exactly this form, edited in place:

```
Last review: 2026-10-29 06:30 UTC (2 tasks, 3 messages)

## Held signals
- 2026-10-29, X: "too stiff" (maybe wants a looser tone; seen once)
```

Remove a signal once it becomes a Note, or after 30 days. Don't put facts or stories here.

## Finish

End with a short summary: how many founder messages you read; each change to voice.md, one line each (new Rule, new Note, Note to Rule, count raised, entry replaced), with why; drafts that broke an existing rule; signals held; and what you skipped as not about voice, in one line. Don't create artifacts; voice.md is the result.

Refer to the founder by name, or as "they". Do not guess pronouns.
