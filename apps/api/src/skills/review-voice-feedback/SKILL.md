---
name: review-voice-feedback
description: Once a day, read what the founder asked to change in the last 24 hours of content tasks, decide which changes say something lasting about how they want to sound, and update voice.md with only those.
---

# Review voice feedback

Learn the founder's voice from how they correct drafts. During the day, Orca only changes the draft it is asked to change; this review looks at all of a day's requests together and decides what is worth keeping. One request on its own rarely proves a habit, so judge carefully and keep voice.md small and true. This is read-only work on tasks: never edit drafts, start tasks or post.

## Process

1. **Read the feedback.** Call `list_content_feedback` (default: the last 24 hours). If it has no tasks, end with one line saying there was no feedback to learn from, and don't touch voice.md.
2. **Sort each founder message.** The founder's own words are enough; don't open the tasks or drafts. A message is voice feedback only when it is about how the post sounds or is shaped: length, line breaks, lists or threads, how it opens or ends, tone, confidence, humor, wording, punctuation, capitalization, emojis, hashtags, words they don't use. These are not voice feedback, so skip them:
   - fixing a fact, number, name, link or date;
   - answering a placeholder question or adding a detail only they know;
   - changing the topic, idea or angle of this one post;
   - asking for variations, a schedule, publishing, or an image;
   - a change that only fits this post ("mention the launch here").
   When it is unclear whether a request is about voice, skip it.
3. **Turn the voice feedback into lessons.** Write each as a general instruction for future posts ("end on the point, not on a status update"), not as a fix to one post. Several messages that ask for the same thing, in one task or in several, are one lesson.
4. **Compare with voice.md** (in your instructions). For each lesson:
   - **New:** add a Note under Rules from edits: today's date, the platform (or "all" when it came from several platforms), the lesson, and the founder's words, quoted short. Mark it "(seen once)".
   - **Already a Note** from an earlier day, or seen in two or more tasks today: make it a Rule, edit that entry in place (don't add a second one), raise its count ("seen 2 times"), and update the variable it belongs to under Variables (or Never does) so the rest of voice.md agrees with it.
   - **Already a Rule:** raise its count and date, and say in the summary that the founder had to ask again although it was a rule.
   - **Contradicts an entry** (they asked for longer posts after a "keep posts short" rule): keep the newer lesson, rewrite the old entry to match, and say so in the summary.
5. **Save** with `save_memory` edits to voice.md, in its layout, changing only what the lessons touch. Update Confidence with today's date. If voice.md doesn't exist yet, create it with the full layout.
6. **Finish** (see Finish).

## Finish

End with a short summary: how many founder messages you read, the lessons you saved (new notes and rules, one line each), and what you skipped as not about voice, in one line. Don't create artifacts; voice.md is the result.

Refer to the founder by name, or as "they". Do not guess pronouns.
