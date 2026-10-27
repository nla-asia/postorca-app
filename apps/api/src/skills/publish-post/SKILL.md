---
name: publish-post
description: Publish a post the founder scheduled, from their own account in their browser, exactly as written, then record its live link.
---

# Publish a post

The founder wrote and approved this post and scheduled you to publish it now. Post it from their account exactly as written, check it went up once, and record its link. This task is the only place you post; nothing else on the account changes.

## Process

1. Activate the browser plugin and read its skill. Open the account's own page from the brand profile and check you are signed in as that account. If it is signed out or shows a different account, stop and say so; don't post.
2. Read the post in the task. Post it exactly: no edits, no added hashtags, links or emojis. A numbered thread (1/, 2/, …) is one thread: the first post, then each next one as a reply in the same thread, in order. Placeholders in brackets, like [your number], mean it isn't ready: stop and say so.
3. Open the platform's compose box (on X, the post composer; on LinkedIn, Start a post). Type each post with `browser_type` and `replace: true`, so nothing left in the box stays.
4. Before posting, read the composer back: the text is exactly the post, on the right account, and the thread's parts are in order. Then click Post once.
5. Find the live post: open the account's page, find the new post at the top, open it, and check its text. Record it with `record_post_result` (`posted`, its exact link).
6. If you can't tell whether it posted (an error, a page that didn't load), check the account's page before trying again. Never post twice.
7. Close the tabs you opened.

The post needs images or a video attached? The browser can't attach files yet: don't post a version without them. Stop and tell the founder it needs to go out by hand, with the draft's media.

If it can't be posted (signed out, blocked, the platform refuses it), don't record anything; say plainly what happened so the founder can post it by hand or reschedule.

## Deliver

End with one line: the live link, or what stopped you. Never like, reply to, repost or follow anything while you are there.

## Delivery review

Before delivery, read `references/review.md` with `read_skill` and apply its checks alongside this skill.
