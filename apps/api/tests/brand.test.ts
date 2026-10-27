import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { createUser } from "../src/repositories/users.js";
import { issueToken } from "../src/middleware/auth.js";
import type { ProfileInput } from "../src/schemas/brand.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "brand-test-secret-at-least-32-characters";
type Link = {
  id: string;
  name: string;
  url: string;
  kind: string;
  publishing_method: string;
  publishing_instructions: string;
  access_status: string;
};
type Profile = Omit<ProfileInput, "links"> & { links: Link[] };
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let server: Server;
let url: string;
let a: { id: string; token: string }, b: { id: string; token: string };
before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  const first = await createUser(
    fixture.db,
    "Founder A",
    "brand-a@example.com",
    "brand-test-password",
  );
  const second = await createUser(
    fixture.db,
    "Founder B",
    "brand-b@example.com",
    "brand-test-password",
  );
  a = { id: first.id, token: issueToken(first.id, secret) };
  b = { id: second.id, token: issueToken(second.id, secret) };
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/brand-profile`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture?.close();
});
async function request(token?: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: (await response.json()) as Profile & { error?: string },
  };
}

test("brand endpoints require authentication and return the account's empty profile", async () => {
  assert.equal((await request()).status, 401);
  assert.equal(
    (await request(undefined, { company: "Unauthenticated" })).status,
    401,
  );
  assert.deepEqual((await request(a.token)).data, {
    name: "Founder A",
    company: "",
    audience: "",
    voice: "",
    topics: "",
    colors: {},
    links: [],
    projects: [],
    onboarding_status: "not_started",
  });
});

test("profile saves persist brand context and account name without affecting another user", async () => {
  const context = {
    name: "Updated Founder",
    company: "Building a product",
    audience: "Builders",
    voice: "Direct",
    topics: "Product development",
    colors: { background: "#123456", text: "#ABCDEF", highlight: "#ff8800" },
    links: [],
    onboarding_status: "in_progress",
  };
  const saved = await request(a.token, context);
  assert.equal(saved.status, 200);
  // Projects are managed separately and come back with the profile.
  assert.deepEqual(saved.data, { ...context, projects: [] });
  assert.deepEqual((await request(a.token)).data, { ...context, projects: [] });
  const me = await fetch(url.replace("/brand-profile", "/auth/me"), {
    headers: { Authorization: `Bearer ${a.token}` },
  });
  assert.equal(
    ((await me.json()) as { user: { name: string } }).user.name,
    context.name,
  );
  assert.equal((await request(b.token)).data.company, "");
});

test("links keep stable IDs, metadata, sort order and multiple accounts per platform", async () => {
  const saved = await request(a.token, {
    links: [
      {
        name: "X Personal",
        url: "https://x.com/founder",
        kind: "x",
        publishing_method: "Manual",
        publishing_instructions: "Review first",
        access_status: "granted",
      },
      { name: "X Product", url: "https://x.com/product", kind: "x" },
      { name: "Website", url: "https://example.com", kind: "website" },
    ],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(
    saved.data.links.map((link) => link.name),
    ["Website", "X Personal", "X Product"],
  );
  assert.equal(new Set(saved.data.links.map((link) => link.id)).size, 3);
  const personal = saved.data.links.find((link) => link.name === "X Personal")!;
  const website = saved.data.links.find((link) => link.name === "Website")!;
  assert.equal(website.access_status, "not_granted");
  const edited = await request(a.token, {
    links: [
      { id: personal.id, name: personal.name, url: personal.url },
      { ...website, url: "https://example.com/about" },
    ],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.links.length, 2);
  assert.deepEqual(
    edited.data.links.find((link) => link.id === personal.id),
    personal,
  );
  assert.equal(
    edited.data.links.find((link) => link.id === website.id)?.url,
    "https://example.com/about",
  );
  const partial = await request(a.token, { voice: "Practical" });
  assert.deepEqual(partial.data.links, edited.data.links);
  const changed = await request(a.token, {
    links: edited.data.links.map((link) =>
      link.id === personal.id
        ? {
            ...link,
            url: "https://x.com/new-profile",
            access_status: "granted",
          }
        : link,
    ),
  });
  assert.equal(
    changed.data.links.find((link) => link.id === personal.id)?.access_status,
    "not_granted",
  );
});

test("foreign or duplicate link IDs are rejected without partial profile changes", async () => {
  const current = (await request(a.token)).data;
  const link = current.links[0];
  const foreign = await request(b.token, {
    name: "Must not change",
    links: [link],
  });
  assert.equal(foreign.status, 404);
  assert.equal((await request(b.token)).data.name, "Founder B");
  assert.equal((await request(a.token, { links: [link, link] })).status, 400);
  assert.deepEqual((await request(a.token)).data, current);
});

test("profile validation rejects unknown fields, unsafe links, invalid colors and excessive input", async () => {
  const current = (await request(a.token)).data;
  for (const body of [
    { user_id: b.id },
    { name: " " },
    { company: "x".repeat(5001) },
    { colors: { background: "red" } },
    { colors: { accent: "#123456" } },
    { links: [{ name: "Bad", url: "javascript:alert(1)" }] },
    { links: [{ name: "Bad", url: "file:///tmp/example" }] },
    {
      links: [{ name: "Bad", url: "https://example.com", kind: "unsupported" }],
    },
    {
      links: [
        { name: "Bad", url: "https://example.com", access_status: "maybe" },
      ],
    },
    {
      links: Array.from({ length: 51 }, (_, i) => ({
        name: `Link ${i}`,
        url: "https://example.com",
      })),
    },
  ])
    assert.equal((await request(a.token, body)).status, 400);
  assert.deepEqual((await request(a.token)).data, current);
});

test("completion requires building context, topics and a social account", async () => {
  assert.equal(
    (await request(b.token, { onboarding_status: "completed" })).status,
    400,
  );
  assert.equal(
    (
      await request(b.token, {
        company: "Product",
        topics: "Building",
        links: [
          { name: "Website", url: "https://example.com", kind: "website" },
        ],
        onboarding_status: "completed",
      })
    ).status,
    400,
  );
  const complete = await request(b.token, {
    company: "Product",
    topics: "Building",
    links: [
      {
        name: "LinkedIn",
        url: "https://www.linkedin.com/in/founder",
        kind: "linkedin",
      },
    ],
    onboarding_status: "completed",
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.data.onboarding_status, "completed");
  const removed = await request(b.token, {
    links: [],
    onboarding_status: "in_progress",
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.links.length, 0);
});

test("a failed link write rolls back name, profile and link changes together", async (context) => {
  const current = (await request(a.token)).data;
  context.mock.method(console, "error", () => {});
  await fixture.db.query(
    "CREATE FUNCTION reject_brand_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only failure'; END; $$; CREATE TRIGGER reject_brand_link BEFORE INSERT ON brand_profile_links FOR EACH ROW EXECUTE FUNCTION reject_brand_link()",
  );
  try {
    const saved = await request(a.token, {
      name: "Rolled back",
      company: "Rolled back",
      links: [{ name: "New link", url: "https://example.org" }],
    });
    assert.equal(saved.status, 500);
    assert.deepEqual((await request(a.token)).data, current);
  } finally {
    await fixture.db.query(
      "DROP TRIGGER reject_brand_link ON brand_profile_links; DROP FUNCTION reject_brand_link()",
    );
  }
});

test("deleting an account cascades through its profile and links", async () => {
  assert.ok((await request(b.token)).data.links.length === 0);
  const saved = await request(b.token, {
    links: [{ name: "Website", url: "https://example.com" }],
  });
  assert.equal(saved.status, 200);
  await fixture.db.query("DELETE FROM users WHERE id=$1", [b.id]);
  assert.equal(
    (
      await fixture.db.query(
        "SELECT 1 FROM brand_profile_links WHERE user_id=$1",
        [b.id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await fixture.db.query("SELECT 1 FROM brand_profiles WHERE user_id=$1", [
        b.id,
      ])
    ).rowCount,
    0,
  );
});
