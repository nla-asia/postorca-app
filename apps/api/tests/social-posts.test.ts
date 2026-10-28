import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../src/migrate.js";
import { createUser } from "../src/repositories/users.js";
import { createWorkTask } from "../src/repositories/tasks.js";
import { createArtifact } from "../src/repositories/artifacts.js";
import {
  recordPostResult,
  schedulePost,
} from "../src/repositories/publications.js";
import {
  capText,
  POST_TEXT_LIMIT,
  postIdFromUrl,
} from "../src/repositories/social-posts.js";
import { executeTool } from "../src/tools/index.js";
import { temporaryPostgres } from "./postgres.js";

let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let accountNumber = 0;
before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
});
after(async () => {
  await fixture?.close();
});

type Context = { userId: string; taskId: string; turnId: string };
const run = (context: Context, name: string, args: unknown) =>
  executeTool(fixture.db, context, name, args) as Promise<any>;

async function founder() {
  const user = await createUser(
    fixture.db,
    "Founder",
    `posts-${++accountNumber}@example.com`,
    "posts-test-password",
  );
  const userId = user.id as string;
  const { task, turn } = await createWorkTask(fixture.db, userId, "Work", "Work", "X");
  const context = { userId, taskId: task.id as string, turnId: turn.id as string };
  const link = async (name: string, url: string, kind: string) =>
    (await run(context, "save_brand_link", { name, url, kind })).id as string;
  return { userId, context, link };
}

test("post IDs come from each platform's links, and text is capped", () => {
  const cases: [string, string, string | null][] = [
    ["X", "https://x.com/nla_asia/status/1850000000000000001", "1850000000000000001"],
    ["X", "https://twitter.com/a/status/42?s=20", "42"],
    ["Threads", "https://www.threads.net/@a/post/C9xYz_1-ab", "C9xYz_1-ab"],
    ["Instagram", "https://www.instagram.com/p/DAbc123/", "DAbc123"],
    ["Instagram", "https://www.instagram.com/reel/DReel9/", "DReel9"],
    ["Instagram", "https://www.instagram.com/stories/postorca.app/3456789/", "3456789"],
    ["LinkedIn", "https://www.linkedin.com/feed/update/urn:li:activity:7250000000000000000/", "7250000000000000000"],
    ["LinkedIn", "https://www.linkedin.com/posts/someone_title-activity-7251111111111111111-AbCd", "7251111111111111111"],
    ["Facebook", "https://www.facebook.com/permalink.php?story_fbid=987&id=1", "987"],
    ["Facebook", "https://www.facebook.com/page/posts/pfbid02abc", "pfbid02abc"],
    ["X", "https://x.com/nla_asia", null],
    ["X", "not a url", null],
  ];
  for (const [platform, url, id] of cases)
    assert.equal(postIdFromUrl(platform, url), id, url);

  assert.deepEqual(capText("short"), { text: "short", text_truncated: false, text_length: 5 });
  const long = capText("😀".repeat(POST_TEXT_LIMIT + 10));
  assert.equal([...long.text!].length, POST_TEXT_LIMIT);
  assert.equal(long.text_truncated, true);
  assert.equal(long.text_length, POST_TEXT_LIMIT + 10);
  assert.deepEqual(capText(null), { text: null, text_truncated: false, text_length: null });
});

test("save_my_posts upserts by post ID, keeps descriptions, and records syncs and deletions", async () => {
  const { userId, context, link } = await founder();
  const xId = await link("Personal X", "https://x.com/founder", "x");
  await link("Product X", "https://x.com/product", "x");

  // No routine account for this task: the account must be named, and must be one.
  await assert.rejects(run(context, "save_my_posts", { posts: [] }), /Pass account/);
  await assert.rejects(
    run(context, "save_my_posts", { account: "X", posts: [] }),
    /No social account matches/,
  );
  // Kinds must fit the platform, and every post needs its link or ID.
  await assert.rejects(
    run(context, "save_my_posts", {
      account: "https://x.com/founder",
      posts: [{ kind: "reel", url: "https://x.com/founder/status/1" }],
    }),
    /X has no reel posts/,
  );
  await assert.rejects(
    run(context, "save_my_posts", { account: "Personal X", posts: [{ kind: "post" }] }),
  );

  const first = await run(context, "save_my_posts", {
    account: "https://x.com/founder/",
    synced: true,
    posts: [
      {
        kind: "post",
        url: "https://x.com/founder/status/100",
        text: "Shipping the boring parts today.",
        posted_at: "2026-10-27T08:00:00Z",
        media_type: "image",
        media_description: "Screenshot of a settings page.",
        stats: { likes: 3, views: 120 },
      },
      {
        kind: "reply",
        url: "https://x.com/founder/status/101",
        text: "ha, same here",
        reply_to_url: "https://x.com/someone/status/99",
        posted_at: "2026-10-27T09:00:00Z",
      },
      { kind: "repost", url: "https://x.com/other/status/102", posted_at: "2026-10-27T10:00:00Z" },
    ],
  });
  assert.equal(first.saved, 3);
  assert.equal(first.platform, "X");
  assert.ok(first.posts_synced_at);

  // A refresh overwrites text and stats but never re-describes media.
  await run(context, "save_my_posts", {
    account: "Personal X",
    posts: [
      {
        kind: "post",
        url: "https://x.com/founder/status/100",
        text: "Shipping the boring parts today. (edited)",
        media_type: "image",
        media_description: "A different description.",
        stats: { likes: 9, views: 400 },
      },
    ],
  });
  const { rows } = await fixture.db.query(
    "SELECT * FROM social_posts WHERE user_id=$1 AND post_id='100'",
    [userId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, "Shipping the boring parts today. (edited)");
  assert.equal(rows[0].media_description, "Screenshot of a settings page.");
  assert.deepEqual(rows[0].stats, { likes: 9, views: 400 });
  assert.ok(rows[0].stats_checked_at);
  assert.equal(rows[0].link_id, xId);
  assert.equal(rows[0].source, "sync");

  const deleted = await run(context, "save_my_posts", {
    account: "Personal X",
    posts: [],
    deleted_post_ids: ["101", "nope"],
  });
  assert.equal(deleted.deleted, 1);
  const listed = await run(context, "list_my_posts", { account: "Personal X" });
  assert.deepEqual(listed.posts.map((p: any) => p.post_id), ["100"]);
  // Seen again on a later read: no longer deleted.
  await run(context, "save_my_posts", {
    account: "Personal X",
    posts: [{ kind: "reply", url: "https://x.com/founder/status/101", text: "ha, same here" }],
  });
  assert.equal(
    (await run(context, "list_my_posts", { account: "Personal X" })).posts.length,
    2,
  );
});

test("list_my_posts and search_my_posts read the founder's own posts with their freshness", async () => {
  const { context, link } = await founder();
  await link("X", "https://x.com/maker", "x");
  await link("Insta", "https://www.instagram.com/maker.app", "instagram");
  await run(context, "save_my_posts", {
    account: "X",
    synced: true,
    posts: [
      { kind: "post", url: "https://x.com/maker/status/1", text: "Old post about pricing", posted_at: "2026-10-01T08:00:00Z" },
      { kind: "post", url: "https://x.com/maker/status/2", text: "New post about 100% focus_time", posted_at: "2026-10-28T08:00:00Z" },
      { kind: "repost", url: "https://x.com/someone/status/3", posted_at: "2026-10-28T09:00:00Z" },
    ],
  });
  await run(context, "save_my_posts", {
    account: "https://instagram.com/maker.app",
    posts: [
      {
        kind: "reel",
        url: "https://www.instagram.com/reel/AbC/",
        media_type: "video",
        media_description: "A desk timelapse.",
        posted_at: "2026-10-27T08:00:00Z",
      },
    ],
  });

  const all = await run(context, "list_my_posts", {});
  // Newest first, plain reposts left out unless asked.
  assert.deepEqual(all.posts.map((p: any) => p.post_id), ["2", "AbC", "1"]);
  assert.match(all.note, /never their voice/);
  const reel = all.posts.find((p: any) => p.kind === "reel");
  assert.equal(reel.postorca_media_description, "A desk timelapse.");
  assert.equal(reel.text, null);
  assert.equal(reel.account, "Insta");
  assert.equal("media_description" in reel, false);
  // Each covered account says when it was last read in full.
  const byName = Object.fromEntries(all.accounts.map((a: any) => [a.name, a]));
  assert.ok(byName.X.posts_synced_at);
  assert.equal(byName.Insta.posts_synced_at, null);

  const today = await run(context, "list_my_posts", {
    platform: "X",
    since: "2026-10-28T00:00:00Z",
    include_reposts: true,
  });
  assert.deepEqual(today.posts.map((p: any) => p.kind), ["repost", "post"]);
  assert.deepEqual(today.accounts.map((a: any) => a.name), ["X"]);
  assert.deepEqual(
    (await run(context, "list_my_posts", { kinds: ["reel"] })).posts.map((p: any) => p.post_id),
    ["AbC"],
  );

  // Search matches text literally, case-insensitively, including % and _.
  assert.deepEqual(
    (await run(context, "search_my_posts", { query: "PRICING" })).posts.map((p: any) => p.post_id),
    ["1"],
  );
  assert.deepEqual(
    (await run(context, "search_my_posts", { query: "100% focus_" })).posts.map((p: any) => p.post_id),
    ["2"],
  );
  assert.equal((await run(context, "search_my_posts", { query: "0%_" })).posts.length, 0);

  // Another founder sees none of it.
  const other = await founder();
  const theirs = await run(other.context, "list_my_posts", {});
  assert.deepEqual(theirs.posts, []);
  assert.equal(theirs.message, "No saved posts match.");
});

test("a scheduled post marked as posted is saved with its draft, account and media", async () => {
  const { userId, link } = await founder();
  const personal = await link("Personal", "https://x.com/founder", "x");
  await link("Product", "https://x.com/product", "x");
  const { task, turn } = await createWorkTask(fixture.db, userId, "Daily quote", "Quote", "X");
  const draft = await createArtifact(fixture.db, task.id, turn.id, {
    kind: "document",
    title: "Quote — X — 2026-10-28",
    content: "Doing what you're good at won't grow you.",
  });
  await createArtifact(fixture.db, task.id, turn.id, {
    kind: "image",
    title: "Quote — X — 2026-10-28 image",
    content: "{}",
  });
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const schedule = (publisher: "founder" | "agent") =>
    schedulePost(fixture.db, userId, task.id, draft.id, {
      text: "Doing what you're good at won't grow you.",
      post_at: soon,
      publisher,
    });

  // Skipped: nothing saved.
  await recordPostResult(fixture.db, userId, (await schedule("founder")).id, { status: "skipped" });
  assert.equal(
    (await fixture.db.query("SELECT 1 FROM social_posts WHERE user_id=$1", [userId])).rowCount,
    0,
  );

  // Two X accounts and no routine account: the link's profile picks the account.
  const posted = await recordPostResult(fixture.db, userId, (await schedule("founder")).id, {
    status: "posted",
    url: "https://x.com/founder/status/555",
  });
  assert.equal(posted.status, "posted");
  const {
    rows: [row],
  } = await fixture.db.query("SELECT * FROM social_posts WHERE user_id=$1", [userId]);
  assert.equal(row.link_id, personal);
  assert.equal(row.platform, "X");
  assert.equal(row.kind, "post");
  assert.equal(row.post_id, "555");
  assert.equal(row.text, "Doing what you're good at won't grow you.");
  assert.equal(row.source, "founder");
  assert.equal(row.artifact_id, draft.id);
  assert.equal(row.media_type, "image");
  assert.match(row.media_description, /Made in PostOrca with this post: image "Quote/);
  assert.ok(row.posted_at);

  // The sync seeing it later refreshes stats but keeps who published it and its draft.
  const context = { userId, taskId: task.id as string, turnId: turn.id as string };
  await run(context, "save_my_posts", {
    account: "https://x.com/founder",
    posts: [{ kind: "post", url: "https://x.com/founder/status/555", text: row.text, stats: { likes: 4 } }],
  });
  const {
    rows: [after],
  } = await fixture.db.query("SELECT * FROM social_posts WHERE user_id=$1", [userId]);
  assert.equal(after.source, "founder");
  assert.equal(after.artifact_id, draft.id);
  assert.deepEqual(after.stats, { likes: 4 });

  // A refused record leaves no row behind.
  await assert.rejects(
    recordPostResult(fixture.db, userId, posted.id, { status: "posted", url: "https://x.com/founder/status/556" }),
    /No open scheduled post/,
  );
  assert.equal(
    (await fixture.db.query("SELECT 1 FROM social_posts WHERE user_id=$1", [userId])).rowCount,
    1,
  );
});

test("the account a routine runs for is the default for saves and published posts", async () => {
  const { userId, link } = await founder();
  await link("Personal", "https://x.com/founder", "x");
  const product = await link("Product", "https://x.com/product", "x");
  const { task, turn } = await createWorkTask(fixture.db, userId, "Sync", "Sync", "X");
  const {
    rows: [routine],
  } = await fixture.db.query(
    `INSERT INTO routines(user_id, platform, title, instructions, time_of_day, days, timezone, active, link_id)
     VALUES ($1, 'X', 'Sync', 'Sync', '07:00', '{1}', 'UTC', false, $2) RETURNING id`,
    [userId, product],
  );
  await fixture.db.query(
    "INSERT INTO routine_runs(routine_id, task_id, trigger, scheduled_for) VALUES ($1, $2, 'manual', now())",
    [routine.id, task.id],
  );
  const context = { userId, taskId: task.id as string, turnId: turn.id as string };
  const saved = await run(context, "save_my_posts", {
    posts: [{ kind: "post", url: "https://x.com/product/status/7", text: "Hi" }],
  });
  assert.equal(saved.account, "Product");

  // A draft written in that routine's task is saved on its account when posted.
  const draft = await createArtifact(fixture.db, task.id, turn.id, {
    kind: "document",
    title: "Post",
    content: "Launch day",
  });
  const publication = await schedulePost(fixture.db, userId, task.id, draft.id, {
    text: "Launch day",
    post_at: new Date(Date.now() + 3_600_000).toISOString(),
    publisher: "agent",
  });
  await recordPostResult(fixture.db, userId, publication.id, {
    status: "posted",
    url: "https://twitter.com/i/web/status/8",
  });
  const {
    rows: [row],
  } = await fixture.db.query(
    "SELECT link_id, source, media_type FROM social_posts WHERE user_id=$1 AND post_id='8'",
    [userId],
  );
  assert.deepEqual(row, { link_id: product, source: "agent", media_type: "none" });
});
