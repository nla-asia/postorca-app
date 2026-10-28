---
name: sync-my-posts
description: Once a day, read the founder's own posts and replies on every social account in the brand profile and save them in PostOrca, so other routines read them without the browser. All accounts in one task.
---

# Sync my posts

Keep PostOrca's copy of the founder's own posts complete and fresh. Other routines (daily quote, connect post, content ideas, conversations) read the founder's posts and voice with `list_my_posts` instead of opening their profiles, so what you save here is what they see. This is read-only work on the founder's own profiles: never like, reply, repost, follow or post.

One task covers every social account in the brand profile (X, Threads, LinkedIn, Instagram, Facebook). Websites and other links are not accounts. If there are none, end with one line saying there is nothing to sync.

## Before you start

1. Call `list_my_posts` with `limit: 1`. Its `accounts` list each account with `posts_synced_at`.
2. Read `posts-sync.md` from memory (see Memory). For each account it records when the last sync of that account finished and how far back its backfill reached.
3. Activate the browser plugin and read its skill.

Plan the run before opening anything. A run has about 100 steps and 45 minutes in all, so share them:

- **First, catch up every account** (new posts since its last sync). This is usually a few pages per account.
- **Then backfill** accounts whose backfill isn't done, with whatever is left, oldest-synced account first.

If you run short, finish the account you are on, save what you have, update memory, and stop. The next run continues.

## Catch up one account

Read from the newest post down to **one day before the account's last finished sync** in memory. The overlap refreshes stats and catches posts that loaded late. An account with no entry in memory has never been synced: read its first few screens as a catch-up and mark its backfill as started.

Where to read, per platform (the account's URL is in the brand profile):

- **X**: the profile (posts, quotes, plain reposts, articles), then `/with_replies` for replies. Skip the pinned post when judging how far back you are. If X shows "Something went wrong" with Retry, click Retry once; if it fails again, skip the account and say so.
- **Threads**: the profile's Threads tab, then its Replies tab.
- **LinkedIn**: `/recent-activity/all/` for posts and reposts, and `/recent-activity/comments/` for the founder's comments (kind `reply`). Never open other people's profiles.
- **Instagram**: the profile grid. A grid item's label often has the caption or alt text; open a post only when it's new and you need its caption, date or kind (reel, carousel). Stories expire after a day: save one only if it's showing.
- **Facebook**: the profile or page timeline.

If a profile shows a sign-in form, or a different account than the brand profile names, skip that account, note it for the final message, and go on with the others.

Scroll a few screens at a time. After each screen or two, save what you read before scrolling on, so a cut-off run keeps its work.

## Saving

Use `save_my_post`, one post per call. Make several calls in the same response (one per post) to save a screen at once. Always pass `account` with the account's profile URL: this task covers many accounts, so there is no default.

- `kind`: `post`, `reply`, `quote`, `repost` (a plain repost with no comment of their own), `article`, `reel`, `story` or `carousel`.
- `url`: the post's own link (on X, `/status/<id>`; on LinkedIn, the `/feed/update/urn:li:activity:…` link).
- `text`: only the founder's own words, exactly as written. For a quote or reply, leave out the post it answers; put that post's link in `reply_to_url`. For a plain repost, give only `kind` and `url`.
- `posted_at`: leave it out on X (it comes from the post's ID). Elsewhere, convert the time shown to ISO 8601 with the founder's time zone. A relative time ("3h", "2d") counts back from when this task started; give your best estimate.
- `stats`: the numbers shown (likes, replies, reposts, views…), as numbers ("1.2K" → 1200).
- `media_type` when the post has an image, video or several images.
- `media_description`: only for a new post that is just an image or video, with no caption and no alt text. Describe it in one or two lines from a `browser_screenshot`. Never re-describe a saved post. A post PostOrca drafted already has its description.

Saving a post again only refreshes it, so re-saving posts in the overlap is fine.

## Posts that are gone

A post saved in the overlap window that you didn't see on the profile may have been deleted. Open its link once: if the platform says it doesn't exist, call `delete_my_post` with its id (from `list_my_posts`). If the page only fails to load, leave it.

## Backfill

The goal is about the last 200 posts and replies per account, so routines have enough of the founder's voice. Continue from where memory says the backfill reached:

- **X**: search `from:<handle> until:<YYYY-MM-DD>` (Latest tab) with the date it reached, instead of scrolling the whole profile again. Replies show in the same search.
- **Elsewhere**: scroll past what's already saved to reach older posts.

Mark an account's backfill as done when it has about 200 saved, or the profile has no older posts.

## Memory

`posts-sync.md`, with the description "When the founder's posts were last synced per account, and how far each backfill reached". One line per account, edited in place:

```
- X @handle: synced 2026-10-28 07:12 · backfill done
- LinkedIn Name: synced 2026-10-28 07:20 · backfill to 2026-08-03
```

Write an account's sync time only after its catch-up finished. Use the founder's local time.

## Finish

Close every tab you opened. End with a short summary, one line per account: new posts saved, posts refreshed, posts marked deleted, backfill progress, and any account skipped and why (signed out, wrong account, a page that kept failing). Don't create artifacts; the saved posts are the result.

Refer to the founder by name, or as "they". Do not guess pronouns.
