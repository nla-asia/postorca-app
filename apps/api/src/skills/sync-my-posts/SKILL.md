---
name: sync-my-posts
description: Once a day, read the founder's own posts and replies on every social account in the brand profile and save them in PostOrca, so other routines read them without the browser. All accounts in one task.
---

# Sync my posts

Keep PostOrca's copy of the founder's own posts complete and fresh. Other routines (daily quote, connect post, content ideas, conversations) read the founder's posts and voice with `list_my_posts` instead of opening their profiles, so what you save here is what they see. This is read-only work on the founder's own profiles: never like, reply, repost, follow or post.

One task covers every social account in the brand profile (X, Threads, LinkedIn, Instagram, Facebook). Websites and other links are not accounts. If there are none, end with one line saying there is nothing to sync.

## Process

Do these steps in order. The run has a limit on steps and time, so share it fairly: finish one account before starting the next, and don't spend most of the run on one account.

1. **Set up.** Call `list_my_posts` with `limit: 1`: its `accounts` list each account with `posts_synced_at`. Read `posts-sync.md` from memory (see Memory). Activate the browser plugin and read its skill.
2. **Sync each account, one after another.** For each account:
   1. **Posts**: read its posts page from the newest post back to where this sync stops (see How far back), and save what's new or changed.
   2. **Replies and comments**: read its replies page the same way and save them (where to read is below).
   3. **Mark it synced**: call `mark_my_posts_synced` with the account's profile URL. Do this for every account you synced, also when nothing was new.
   4. **Update its line** in `posts-sync.md` (see Memory) before you open the next account.
3. **Finish** (see Finish).

## How far back

- **An account's first sync** (no line in memory yet): read back until you have saved **20 posts or reached posts older than six months, whichever comes first**, and the same for its replies or comments. Older posts are left out for good; later syncs never go back for them.
- **Every later sync**: read back to **one day before the account's last sync** in memory. The overlap refreshes stats and catches posts that loaded late. Never go further back than six months.
- **More to read than fits** (for example the first sync after weeks of pauses): save what you reached, write in its line how far back you got, and go on to the next account. The next run continues from there.

## Where to read

Per platform (the account's URL is in the brand profile):

- **X**: posts: the profile (posts, quotes, plain reposts, articles). Replies: `/with_replies`. Skip the pinned post when judging how far back you are. If X shows "Something went wrong" with Retry, click Retry once; if it fails again, skip the account and say so.
- **Threads**: posts: the profile's Threads tab. Replies: its Replies tab.
- **LinkedIn**: posts: `/recent-activity/all/` (posts and reposts). Comments: `/recent-activity/comments/`, saved as kind `reply`: save the founder's comment as `text`, the post it's on as `reply_to_url`, and as `url` the comment's own link (the one with `commentUrn` in it) when the page shows one, otherwise the post's link. Never open other people's profiles.
- **Instagram**: posts: the profile grid (Instagram has no replies page). A grid item's label often has the caption or alt text; open a post only when it's new and you need its caption, date or kind (reel, carousel). Stories expire after a day: save one only if it's showing.
- **Facebook**: posts: the profile or page timeline.

If a profile shows a sign-in form, or a different account than the brand profile names, skip that account, note it for the final message, and go on with the others.

**Read posts from the profile's own timeline, not one by one.** Each post on the timeline already shows its link (the time link, e.g. `→ /<handle>/status/…` on X), its text and its stats, so save straight from the snapshot. Opening a post costs three steps (open, snapshot, close), which a run can't afford per post. Text cut off with "Show more" or "…more" (LinkedIn cuts most long posts): click that button on the timeline, which shows the rest in one step, and only for a post that's new or whose saved text is cut. Open a post itself only for a screenshot for a media description. When the timeline doesn't show the link of the post a reply or quote answers, leave `reply_to_url` out rather than opening the reply to find it.

A long page's snapshot comes in parts, and part 1 is often only the site's menus (LinkedIn's activity pages always). Read the outline it gives and go to the parts with the main content, where the posts are; don't treat an account as done after part 1.

Scroll a few screens at a time. After each screen or two, save what you read before scrolling on, so a cut-off run keeps its work. If a scroll shows nothing new, the page may still be loading: snapshot it once more. If there's still nothing, the page has stopped loading: save what you have, note in the account's line how far back you got, and go on to the next account.

A post or comment the page shows without any link to it can't be saved (`save_my_post` needs its link). Skip it rather than opening other pages to hunt for one, and say in the summary how many you skipped.

## Saving

Use `save_my_post`, one post per call. Make all of a screen's calls in the same response (one per post), not one response per post. Always pass `account` with the account's profile URL: this task covers many accounts, so there is no default.

- `kind`: `post`, `reply`, `quote`, `repost` (a plain repost with no comment of their own), `article`, `reel`, `story` or `carousel`.
- `url`: the post's own link (on X, `/status/<id>`; on LinkedIn, the `/feed/update/urn:li:activity:…` link).
- `text`: only the founder's own words, exactly as written. For a quote or reply, leave out the post it answers; put that post's link in `reply_to_url` when the page shows it. For a plain repost, give only `kind` and `url`.
- `posted_at`: leave it out on X and LinkedIn (it comes from the post's ID). Elsewhere, convert the time shown to ISO 8601 with the founder's time zone. A relative time ("3h", "2d") counts back from when this task started; give your best estimate.
- `stats`: the numbers shown (likes, replies, reposts, views…), as numbers ("1.2K" → 1200).
- `media_type` when the post has an image, video or several images.
- `media_description`: only for a new post that is just an image or video, with no caption and no alt text. Describe it in one or two lines from a `browser_screenshot`. Never re-describe a saved post. A post PostOrca drafted already has its description.

Saving a post again only refreshes it, so re-saving posts in the overlap is fine. To refresh only a saved post's stats, pass its `id` and `stats`.

## Posts that are gone

A post saved in the overlap window that you didn't see on the profile may have been deleted. Open its link once: if the platform says it doesn't exist, call `delete_my_post` with its id (from `list_my_posts`). If the page only fails to load, leave it.

## Memory

`posts-sync.md`, with the description "When the founder's posts were last synced per account". One short line per account, in exactly this form, edited in place:

```
- X @handle: synced 2026-10-28 00:12 UTC
- LinkedIn Name: synced 2026-10-27 00:20 UTC · reached 2026-10-21, more to read
```

Update the file right after each account, before opening the next one, so a run cut short still records what it did. Write the new sync time only when the account's sync reached where it should stop (How far back); otherwise keep the old time and write how far back you got. Write times in UTC, marked as such (e.g. `synced 2026-10-28 00:12 UTC`), as the task's first message gives them.

## Finish

Close every tab you opened. End with a short summary, one line per account: new posts saved, posts refreshed, posts marked deleted, posts skipped for having no link, whether it's fully synced, and any account skipped and why (signed out, wrong account, a page that kept failing). Don't create artifacts; the saved posts are the result.

Refer to the founder by name, or as "they". Do not guess pronouns.
