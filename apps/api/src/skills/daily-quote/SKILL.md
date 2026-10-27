---
name: daily-quote
description: On a day the founder hasn't posted on one account, draft one short, relatable quote for their space as a post and a quote image, so the account stays active; skip when they already posted.
---

# Daily quote

Keep one account active on days the founder has nothing else out. A short, true line about building, learning or the founder's craft is neutral, easy to agree with, and gets likes from the people the founder wants to reach. It is a fallback, not the main content: if the founder already posted today, do nothing.

## First: did they post today?

"Today" is the founder's local date when this task started (its first message says when). Activate the browser plugin and read its skill, open the account's own page from the brand profile, and check the date of its latest posts, including reposts with their own comment. If it is signed out or shows a different account, stop and say so.

If the account already posted today, close the tab and end with one line saying it already posted, with that post's link. Draft nothing.

## The quote

- **Relatable to the founder's audience.** About building, shipping, learning, focus, work habits, or the founder's topics: something people in their space have felt. "Doing what you're already good at won't grow you. Be a beginner again." is the kind of line that works.
- **The founder's own line by default.** Write it from their topics, their recent posts and what they are building, in their voice: one or two sentences, under 25 words, no hashtags. It must be a line the founder could stand behind, not a cliché ("Hustle hard", "Never give up").
- **A known quote only when you can verify it.** If a real quote fits better, use it only after finding its original source (the book, talk or interview), and attribute it exactly. Misattributed quotes get called out; when in doubt, write the founder's own line.
- **New.** Never repeat a quote from the last 90 days or one the account already posted; your memory keeps them (see Memory).
- **Neutral.** No politics, religion, or digs at people or companies. No product mention.

Refer to the founder by name, or as "they". Do not guess pronouns.

## The image

Activate the media plugin and read its skill. Make one square image (1024x1024, medium quality) with the quote as the only text, plus the attribution if it is a known quote, in a clean, readable layout: large type, high contrast, generous margins, simple background. Keep one recognizable style for the founder: read `quote-style.md` from memory and follow it; if there is none yet, choose a style that fits the brand profile (palette, type feel, background) and save it there. Inspect the image: if the text has a typo or is hard to read, fix it once with media_edit_image. If generation fails, don't retry; deliver the text post alone and say the image failed.

The founder may have more than one account on this routine. If `quotes.md` already has today's quote for another account, reuse its line and image ref instead of making new ones, unless this account already posted that line before.

## Process

1. Check whether the account posted today (above). Read the account's recent posts to learn how the founder writes.
2. Read `quotes.md` and `quote-style.md` from memory.
3. Write the quote, then make the image.
4. Close the tabs you opened.
5. Save today's quote to memory before delivering (see Memory).

## Deliver

Create one document artifact titled `Quote — <platform> — <date>` with the post text: the quote itself, plus the attribution for a known quote. Keep it to the quote; on X, at most 280 characters. Then create the image artifact with create_artifact (kind image), titled the same with "image".

In your final message, link both and say in one line that nothing went out on this account today, so this is ready to post with the image attached. Never publish, reply, like, repost or follow. The founder reviews and posts.

## Memory

- `quotes.md`, with the description "Quotes drafted for the founder's accounts: line, source, account and image by date". Under a heading for today's date, note the quote, its source (the founder's own line, or the verified source), the account, and the image ref. Keep the last 90 days. Edit the file in place rather than starting a new one.
- `quote-style.md`, with the description "The founder's quote image style: palette, type, layout and background". Change it only when the founder asks for a different style.

## Delivery review

Before delivery, read `references/review.md` with `read_skill` and apply its checks alongside this skill.
