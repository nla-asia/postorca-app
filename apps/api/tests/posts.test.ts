import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { issueToken } from "../src/middleware/auth.js";
import { createUser } from "../src/repositories/users.js";
import { createWorkTask } from "../src/repositories/tasks.js";
import { executeTool } from "../src/tools/index.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "posts-test-secret-at-least-32-characters";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let server: Server;
let url: string;
let accountNumber = 0;

before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
    null,
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture?.close();
});

async function founder() {
  const user = await createUser(
    fixture.db,
    "Founder",
    `posts-page-${++accountNumber}@example.com`,
    "posts-test-password",
  );
  const userId = user.id as string;
  const { task, turn } = await createWorkTask(
    fixture.db,
    userId,
    "Work",
    "Work",
  );
  const context = {
    userId,
    taskId: task.id as string,
    turnId: turn.id as string,
  };
  const run = (name: string, args: unknown) =>
    executeTool(fixture.db, context, name, args) as Promise<any>;
  return { token: issueToken(userId, secret), run };
}
async function request(path: string, token: string, method = "GET") {
  const response = await fetch(url + path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    data: response.status === 204 ? null : ((await response.json()) as any),
  };
}

test("the Posts page reads the founder's posts by account and tab, pages, and hides one with undo", async () => {
  const a = await founder();
  const x = (
    await a.run("save_brand_link", {
      name: "nla",
      url: "https://x.com/nla",
      kind: "x",
    })
  ).id;
  const li = (
    await a.run("save_brand_link", {
      name: "Nika",
      url: "https://www.linkedin.com/in/nika",
      kind: "linkedin",
    })
  ).id;
  const save = (account: string, post: object) =>
    a.run("save_my_post", { account, ...post });
  const times = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
  for (const [index, day] of times.entries())
    await save("nla", {
      kind: "post",
      url: `https://x.com/nla/status/${index + 1}`,
      text: `Post ${index + 1}`,
      posted_at: `${day}T08:00:00Z`,
    });
  await save("nla", {
    kind: "reply",
    url: "https://x.com/nla/status/10",
    text: "ha, same",
    posted_at: "2026-10-24T08:00:00Z",
  });
  await save("nla", {
    kind: "repost",
    url: "https://x.com/other/status/11",
    posted_at: "2026-10-25T08:00:00Z",
  });
  await save("Nika", {
    kind: "post",
    url: "https://www.linkedin.com/feed/update/urn:li:activity:7250000000000000000/",
    text: "On LinkedIn",
    posted_at: "2026-10-19T08:00:00Z",
    media_type: "image",
    media_description: "A chart.",
  });

  assert.equal((await request("/posts", "")).status, 401);
  const page = await request("/posts", a.token);
  assert.equal(page.status, 200);
  // Posts tab: no replies or plain reposts, newest first, every account.
  assert.deepEqual(
    page.data.posts.map((p: any) => p.text),
    ["Post 4", "Post 3", "Post 2", "Post 1", "On LinkedIn"],
  );
  assert.equal(page.data.has_more, false);
  const accounts = Object.fromEntries(
    page.data.accounts.map((a: any) => [a.name, a]),
  );
  assert.equal(accounts.nla.platform, "X");
  assert.ok(accounts.nla.posts_synced_at);
  assert.equal(page.data.posts.at(-1).media_description, "A chart.");

  const replies = await request(`/posts?view=replies&account=${x}`, a.token);
  assert.deepEqual(
    replies.data.posts.map((p: any) => p.text),
    ["ha, same"],
  );
  const all = await request(`/posts?view=all&account=${x}`, a.token);
  assert.deepEqual(
    all.data.posts.map((p: any) => p.kind),
    ["repost", "reply", "post", "post", "post", "post"],
  );
  assert.deepEqual(
    (await request(`/posts?account=${li}`, a.token)).data.posts.map(
      (p: any) => p.text,
    ),
    ["On LinkedIn"],
  );
  assert.deepEqual(
    (await request("/posts?q=post%203", a.token)).data.posts.map(
      (p: any) => p.text,
    ),
    ["Post 3"],
  );

  // Pages: before the last post shown.
  const first = await request(`/posts?account=${x}&limit=2`, a.token);
  assert.deepEqual(
    first.data.posts.map((p: any) => p.text),
    ["Post 4", "Post 3"],
  );
  assert.equal(first.data.has_more, true);
  const next = await request(
    `/posts?account=${x}&limit=2&before=${encodeURIComponent(first.data.posts[1].posted_at)}`,
    a.token,
  );
  assert.deepEqual(
    next.data.posts.map((p: any) => p.text),
    ["Post 2", "Post 1"],
  );
  assert.equal(next.data.has_more, false);

  // Hide (soft delete) and undo; owner only.
  const b = await founder();
  const target = first.data.posts[0].id;
  assert.equal((await request(`/posts?account=${x}`, b.token)).status, 404);
  assert.equal(
    (await request(`/posts/${target}`, b.token, "DELETE")).status,
    404,
  );
  assert.equal(
    (await request(`/posts/${target}/restore`, b.token, "POST")).status,
    404,
  );
  assert.equal(
    (await request(`/posts/${target}`, a.token, "DELETE")).status,
    204,
  );
  assert.deepEqual(
    (await request(`/posts?account=${x}`, a.token)).data.posts.map(
      (p: any) => p.text,
    ),
    ["Post 3", "Post 2", "Post 1"],
  );
  assert.equal(
    (await request(`/posts/${target}/restore`, a.token, "POST")).status,
    204,
  );
  assert.equal(
    (await request(`/posts?account=${x}`, a.token)).data.posts[0].text,
    "Post 4",
  );
  assert.equal(
    (await request("/posts/not-a-uuid", a.token, "DELETE")).status,
    400,
  );
  assert.deepEqual((await request("/posts", b.token)).data, {
    accounts: [],
    posts: [],
    has_more: false,
  });
});
