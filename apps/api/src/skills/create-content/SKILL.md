---
name: create-content
description: Turn an idea the founder chose into a post in their voice, ask about any details only they know, and revise it or make variations on request.
---

# Create content

Turn one idea the founder chose into a post they can review and publish. The task gives you the idea (its reference, mechanism, hot topic and suggested angle) and may include a note from the founder. The note overrides the idea where they differ.

**Product demos first.** If the idea has a **Demo plan**, it is a product demo: before anything else, read the `product-demo-capture` skill with read_skill and follow it to get the screenshots and clips. The post or video is built on those shots, and the founder's note may ask you to stop at the shots.

## Requirements

- **A complete post.** Write every line of the post or thread, or the text of every slide of a carousel plus what each slide shows. Not an outline.
- **Built on one real detail from the founder.** Every post centers on something that happened to this founder: a specific moment, number, decision or mistake from their own work, with a when and a what. An opinion or a theme they have posted about is not a detail ("agents misunderstand instructions" is a view; "on Tuesday my agent emailed 40 leads the wrong price" is a detail). Use one only if the idea itself (an idea from the founder's work names the commits and facts in **From your work**), your memory (`stories.md`) or their recent posts tell an actual event that fits this idea. Otherwise, and this is the usual case, ask: put one short marked placeholder where it goes, such as [the task you automated first], and ask the founder for it. Never invent it: no made-up numbers, customers, experiments or stories.
- **The detail is the spine.** It opens the post or is its turning point, and the general point grows out of it. Test: delete the detail; if the post still works, it is decoration, so rewrite. Write it as something that happened ("Last month I automated [the task]. It broke when …"), not as a hypothetical ("I'd begin with …"). The story sets the length: usually one post, or a short thread of three or four (what happened, what it showed, the point about the hot topic). Shorten a longer format the idea suggests rather than filling it with general advice; never add posts that are only advice.
- **Nothing beyond what you know.** Every fact in the post comes from the founder's note, the idea, your memory or their posts: what they built and how it works, what users did or said, how the founder felt, why they decided. Don't add any of these to make the story flow, even small plausible ones ("nobody missed it", "I thought setup made it feel serious", "now you just sign up and you're in"). If the post needs one, use a placeholder and ask.
- **Other placeholders only when needed.** At most one more, for a small fact inside a sentence. Everything else is written out.
- **The first line does the work.** It stops someone scrolling and makes sense on its own, without explaining everything.
- **Says something real.** A clear point of view the founder can own, not advice anyone could write. Look for the angle only this founder has: what they are building, what they have posted about, the view from inside their work. If a line would fit on any founder's feed, sharpen it or cut it.
- **Follows the idea.** Keep its mechanism (how it opens, what it holds back, where it pays off) and the hot topic it rides on, rebuilt around the founder. Never copy the reference's wording or story.
- **Made for the founder's accounts.** An idea from the founder's own work isn't tied to one platform: make the versions their accounts need (the brand profile's links), and decide which accounts it really suits; not every idea belongs everywhere. Text: one document per platform, titled with the platform. Videos and images: the shapes the chosen accounts need, one artifact per shape, titled with it and where it fits: portrait 9:16 for Instagram, TikTok and YouTube Shorts; landscape 16:9 (or square) for X, LinkedIn and YouTube. One landscape video often serves every platform except the vertical ones. An idea that came from a post on one platform (the daily content ideas) stays on that platform.
- **Fits the platform.**
  - X: one post of at most 280 characters, or a thread when the idea needs more room; number thread posts 1/, 2/, … and keep each under 280 characters. X counts every character, including spaces and line breaks; aim for 250 or fewer so the post fits with room to spare.
  - LinkedIn: a text post in short paragraphs, as long as the founder's own recent LinkedIn posts (if they write three lines, write three lines); about 100–250 words only when there are none to go by, and never more than 250.
  - Other platforms: their usual format and limits, and the format the idea named.
  - Hashtags: none on LinkedIn, at most one on X. Emojis only if the founder's own recent posts use them.
  - Follow the account's publishing instructions in the brand profile.
- **Sounds like the founder.** Follow voice.md (in your instructions): their picks, habits, what they never do, the rules from their edits, and this platform's differences. Their recent posts on this account show how that looks in practice: sentence length, tone, how they open, whether they use lists or emojis.
- **Grows the profile, not an ad.** The company appears only where it truly fits, late and naturally, or not at all. Nothing should feel written by a marketing team.

Refer to the founder by name, or as "they". Do not guess pronouns.

## Process

1. Read the idea and the founder's note in the task. Search your memory for the founder's stories (`stories.md`) and keep any that fit this idea.
2. Read the founder's saved recent posts with `list_my_posts` to learn how they write and what they already said; don't open their social accounts for this. If a reference post on another site helps, activate the browser plugin and open just that post to see its structure. Do not engage with anything. Close the tabs you opened.
3. Write the post. Then check it against voice.md line by line (length and layout, punctuation and capitalization, emojis and hashtags, words they never use, the rules from edits) and fix what doesn't match. Read it once more as a stranger scrolling past: if the opening explains too much, a line is generic, the company appears too early, or it breaks the platform limits, fix it before delivering.

## Deliver

Create one document artifact per platform version, titled with the post's working title and the platform. Its content, in this order:

1. The post itself, ready to paste once any placeholders are filled. For a thread, every numbered post; for a carousel, slide-by-slide text and visuals.
2. **Other openings:** two alternative first lines.
3. **Placeholders:** each placeholder in the post, if any.

Add no notes about how you wrote it.

In your final message, link the document and ask the founder one specific question for each placeholder, so they can answer in a follow-up. Make the question about the real detail easy to answer in a sentence or two, and give a short example of the kind of answer you mean. If the post used a story from memory, say which one, so the founder can swap it. If there are no placeholders, say it is ready to post.

When the founder answers or asks for changes in a follow-up, change only what they asked for and keep the rest. "More personal" means their own words and stories from memory or their posts, never invented feelings or events. When nothing personal on record fits, put one placeholder where it belongs (such as [why you cut the setup step]) and ask for it in your final message; don't just strip the post down to the facts. Revise the existing document with edit_document: read_artifact first, because the founder may have edited it by hand, then replace only the passages that change, so one current version remains. When the founder gives the real detail, rework the lines around it so the post reads as their story, not a filled-in template; keep the opening's mechanism. When every placeholder is filled, remove the placeholder list. A revised post must still fit the platform limits: if new text pushes an X post past 280 characters, tighten other lines, or make it a thread if the founder prefers.

When they ask for variations, keep the same mechanism and change the scenario, the hook, or the angle. Each variation must be a different post that could run on the same account, not a rewrite of the same one. Deliver each as its own document artifact.

Before you finish, make sure every tab you opened is closed. Never publish. The founder reviews and posts.

## Memory

When the founder tells you a real story or detail, save it to `stories.md` in your memory, with the description "The founder's own stories and details for posts: what happened, numbers, and where it was used". One short entry per story: what happened, any numbers, the date, and the posts that used it. Edit the file in place rather than starting a new one. Prefer a story that hasn't been used in a recent post.

## Delivery review

Before delivery, read `references/review.md` with `read_skill` and apply its checks alongside this skill.
