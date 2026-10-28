import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { temporaryPostgres } from "./postgres.js";
import { migrate } from "../src/migrate.js";
import { createUser } from "../src/repositories/users.js";
import {
  costToCredits,
  ensureWelcomeCredits,
  getCreditSummary,
  reconcileApiCredits,
  reserveApiCredits,
  settleApiCredits,
} from "../src/billing/credits.js";
import { withApiUsage } from "../src/api-usage/ledger.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { creditTerms } from "../src/billing/terms.js";

let f: Awaited<ReturnType<typeof temporaryPostgres>>, recoveryDirectory: string;
before(async () => {
  f = await temporaryPostgres();
  await migrate(f.db);
  recoveryDirectory = await mkdtemp(join(tmpdir(), "postorca-credit-test-"));
});
after(async () => {
  await f?.close();
  if (recoveryDirectory)
    await rm(recoveryDirectory, { recursive: true, force: true });
});
async function user(balance = 250) {
  const u = await createUser(
    f.db,
    "Credits QA",
    `${randomUUID()}@example.test`,
    "test-password",
  );
  if (balance !== 250)
    await f.db.query(
      "INSERT INTO credit_ledger(user_id,amount,description,reference) VALUES ($1,$2,'Fixture',$3)",
      [u.id, balance - 250, randomUUID()],
    );
  return u.id as string;
}
async function request(
  userId: string,
  operation = "responses",
  model = "gpt-6-luna",
  turnId: string | null = null,
) {
  const id = randomUUID();
  await f.db.query(
    "INSERT INTO api_requests(id,user_id,turn_id,provider,model,operation,started_at) VALUES ($1,$2,$3,'openai',$4,$5,now())",
    [id, userId, turnId, model, operation],
  );
  return { id, userId, provider: "openai", model, operation, args: {} };
}
async function row(id: string) {
  return (await f.db.query("SELECT * FROM api_requests WHERE id=$1", [id]))
    .rows[0];
}

async function turn(userId: string, title = "Write a launch post") {
  const {
    rows: [task],
  } = await f.db.query(
    "INSERT INTO tasks(user_id,kind,title) VALUES ($1,'work',$2) RETURNING id",
    [userId, title],
  );
  const {
    rows: [t],
  } = await f.db.query(
    "INSERT INTO turns(task_id,status) VALUES ($1,'running') RETURNING id",
    [task.id],
  );
  return t.id as string;
}
async function spend(r: { id: string }, cost: string) {
  await f.db.query(
    "UPDATE api_requests SET status='succeeded',estimated_cost=$2,estimated_currency='USD' WHERE id=$1",
    [r.id, cost],
  );
  await settleApiCredits(f.db, r.id);
}
const usage = async (userId: string) =>
  (
    await f.db.query(
      "SELECT amount,description FROM credit_ledger WHERE user_id=$1 AND reference LIKE 'usage:%' ORDER BY created_at",
      [userId],
    )
  ).rows;

test("one credit is $0.04 of AI cost; exact costs keep nine decimals until a turn is charged", () => {
  assert.equal(creditTerms.usdPerCredit, "0.04");
  assert.equal(costToCredits("0.01"), "0.250000000");
  assert.equal(costToCredits("0.013"), "0.325000000");
  assert.equal(costToCredits("0.000000000001"), "0.000000001");
  assert.throws(() => costToCredits("-1"));
});
test("signup welcome grants are transactional and idempotent; credits survive account cancellation and deletion cascades", async () => {
  const id = await user();
  await Promise.all([
    ensureWelcomeCredits(f.db, id),
    ensureWelcomeCredits(f.db, id),
  ]);
  const summary = await getCreditSummary(f.db, id);
  assert.equal(summary.balance, 250);
  assert.equal(summary.entries.length, 1);
  await f.db.query(
    "INSERT INTO billing_accounts(user_id,stripe_customer_id,subscription_status) VALUES ($1,$2,'canceled')",
    [id, `cus_${randomUUID()}`],
  );
  assert.equal((await getCreditSummary(f.db, id)).balance, 250);
  await f.db.query("DELETE FROM users WHERE id=$1", [id]);
  assert.equal(
    (await f.db.query("SELECT * FROM credit_ledger WHERE user_id=$1", [id]))
      .rowCount,
    0,
  );
});
test("parallel reservations cannot overspend the account; a released hold makes budget available again", async () => {
  const id = await user(4),
    a = await request(id),
    b = await request(id);
  const attempts = await Promise.allSettled([
    reserveApiCredits(f.db, a),
    reserveApiCredits(f.db, b),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const held = (await row(a.id)).credit_state === "reserved" ? a : b;
  const blocked = held === a ? b : a;
  assert.equal((await row(blocked.id)).credit_state, "blocked");
  assert.ok((await getCreditSummary(f.db, id)).balance < 2);
  await f.db.query(
    "UPDATE api_requests SET status='failed',http_status=429 WHERE id=$1",
    [held.id],
  );
  await settleApiCredits(f.db, held.id);
  await reserveApiCredits(f.db, blocked);
  assert.equal((await row(held.id)).credit_state, "released");
  assert.equal((await row(blocked.id)).credit_state, "reserved");
});
test("a turn is charged its total real cost once, rounded up to a whole credit", async () => {
  const id = await user(),
    turnId = await turn(id);
  for (const cost of ["0.004", "0.004", "0.004"]) {
    const r = await request(id, "responses", "gpt-6-luna", turnId);
    await reserveApiCredits(f.db, r);
    await spend(r, cost);
  }
  // Three calls costing $0.012 in total are 0.3 credits: one credit, not three.
  assert.deepEqual(await usage(id), [
    { amount: "-1.000000000", description: "Orca: Write a launch post" },
  ]);
  assert.equal((await getCreditSummary(f.db, id)).balance, 249);
  const image = await request(
    id,
    "image.generate",
    "gpt-image-2.5-flare",
    turnId,
  );
  await reserveApiCredits(f.db, image);
  await spend(image, "0.15");
  // $0.162 is 4.05 credits, so the same entry becomes 5.
  assert.deepEqual(await usage(id), [
    { amount: "-5.000000000", description: "Orca: Write a launch post" },
  ]);
  const summary = await getCreditSummary(f.db, id);
  assert.equal(summary.balance, 245);
  assert.equal(summary.entries.length, 2);
});
test("separate turns and requests outside a turn are each rounded on their own", async () => {
  const id = await user();
  for (const turnId of [await turn(id, "First"), await turn(id, "Second")]) {
    const r = await request(id, "responses", "gpt-6-luna", turnId);
    await reserveApiCredits(f.db, r);
    await spend(r, "0.001");
  }
  const loose = await request(id, "image.generate", "gpt-image-2.5-flare");
  await reserveApiCredits(f.db, loose);
  await spend(loose, "0.05");
  assert.deepEqual(
    (await usage(id)).map((r: any) => [r.amount, r.description]),
    [
      ["-1.000000000", "Orca: First"],
      ["-1.000000000", "Orca: Second"],
      ["-2.000000000", "Image generation"],
    ],
  );
  assert.equal((await getCreditSummary(f.db, id)).balance, 246);
});
test("settlement charges usage once with saved terms; reconciliation rewrites the turn's whole-credit charge", async () => {
  const id = await user(),
    r = await request(id);
  await reserveApiCredits(f.db, r);
  await f.db.query(
    "UPDATE api_requests SET status='succeeded',estimated_cost='0.01',estimated_currency='USD' WHERE id=$1",
    [r.id],
  );
  await Promise.all([
    settleApiCredits(f.db, r.id),
    settleApiCredits(f.db, r.id),
  ]);
  assert.equal((await row(r.id)).credit_charged, "0.250000000");
  assert.equal((await getCreditSummary(f.db, id)).balance, 249);
  assert.equal((await getCreditSummary(f.db, id)).reserved, 0);
  await reconcileApiCredits(f.db, {
    id: r.id,
    cost: "0.005",
    currency: "USD",
    source: "fixture invoice",
  });
  await reconcileApiCredits(f.db, {
    id: r.id,
    cost: "0.005",
    currency: "USD",
    source: "fixture invoice",
  });
  assert.equal((await row(r.id)).credit_charged, "0.125000000");
  assert.equal((await row(r.id)).estimated_cost, "0.010000000000");
  assert.equal((await row(r.id)).credit_version, 2);
  assert.equal((await getCreditSummary(f.db, id)).balance, 249);
  await reconcileApiCredits(f.db, {
    id: r.id,
    cost: "0.06",
    currency: "USD",
    source: "fixture invoice",
  });
  assert.equal((await getCreditSummary(f.db, id)).balance, 248);
  await reconcileApiCredits(f.db, {
    id: r.id,
    cost: "0",
    currency: "USD",
    source: "Provider confirmed no charge",
  });
  assert.equal((await getCreditSummary(f.db, id)).balance, 250);
  assert.equal((await usage(id)).length, 0);
});
test("accepted unknown costs, network errors, 408s and 5xxs retain holds until verified reconciliation", async () => {
  for (const status of [null, 408, 503, 200]) {
    const id = await user(),
      r = await request(id);
    await reserveApiCredits(f.db, r);
    await f.db.query(
      "UPDATE api_requests SET status=$2,http_status=$3 WHERE id=$1",
      [r.id, status === 200 ? "succeeded" : "failed", status],
    );
    await settleApiCredits(f.db, r.id);
    assert.equal((await row(r.id)).credit_state, "pending");
    assert.ok((await getCreditSummary(f.db, id)).reserved > 0);
    await reconcileApiCredits(f.db, {
      id: r.id,
      cost: "0",
      currency: "USD",
      source: "Provider confirmed no charge",
    });
    assert.equal((await getCreditSummary(f.db, id)).reserved, 0);
  }
});
test("requests reserved before turn charging keep their exact per-request entries", async () => {
  const id = await user(),
    r = await request(id);
  await reserveApiCredits(f.db, r);
  await f.db.query("UPDATE api_requests SET credit_group=NULL WHERE id=$1", [
    r.id,
  ]);
  await spend(r, "0.01");
  assert.equal((await usage(id)).length, 0);
  assert.equal((await getCreditSummary(f.db, id)).balance, 249.75);
});
test("historical requests are never backcharged; actual overages block future requests", async () => {
  const id = await user(),
    old = await request(id);
  await f.db.query(
    "UPDATE api_requests SET status='succeeded',estimated_cost=1,estimated_currency='USD' WHERE id=$1",
    [old.id],
  );
  await reconcileApiCredits(f.db, {
    id: old.id,
    cost: "2",
    currency: "USD",
    source: "Historical invoice",
  });
  assert.equal((await getCreditSummary(f.db, id)).balance, 250);
  const r = await request(id);
  await reserveApiCredits(f.db, r);
  await f.db.query(
    "UPDATE api_requests SET status='failed',estimated_cost=11,estimated_currency='USD' WHERE id=$1",
    [r.id],
  );
  await settleApiCredits(f.db, r.id);
  assert.ok((await getCreditSummary(f.db, id)).balance < 0);
  await assert.rejects(
    reserveApiCredits(f.db, await request(id)),
    /Not enough credits/,
  );
});
test("an exhausted allowance stops the real SDK before transport with no automatic retries", async (t) => {
  const id = await user(0);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({});
  });
  const provider = new OpenAIProvider("test-key", "gpt-6-luna");
  await assert.rejects(
    withApiUsage({ db: f.db, userId: id, recoveryDirectory }, () =>
      provider.respond({
        instructions: "Test",
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      }),
    ),
    /Not enough credits/,
  );
  assert.equal(calls, 0);
  const rows = (
    await f.db.query("SELECT * FROM api_requests WHERE user_id=$1", [id])
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].credit_state, "blocked");
  assert.equal(rows[0].error_code, "insufficient_credits");
});
test("unknown models cannot bypass credit reservations; free catalog reads need no hold", async (t) => {
  const id = await user(0);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({
      voices: [],
      has_more: false,
      next_page_token: null,
    });
  });
  const { usageFetch } = await import("../src/api-usage/ledger.js");
  const blocked = await withApiUsage(
    { db: f.db, userId: id, recoveryDirectory },
    () =>
      usageFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        body: JSON.stringify({ model: "unknown" }),
      }),
  );
  assert.equal(blocked.status, 402);
  assert.equal(calls, 0);
  const catalog = await withApiUsage(
    { db: f.db, userId: id, recoveryDirectory },
    () => usageFetch("https://api.elevenlabs.io/v2/voices"),
  );
  assert.equal(catalog.status, 200);
  assert.equal(calls, 1);
});
