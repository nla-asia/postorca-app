import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { temporaryPostgres } from "./postgres.js";
import { migrate } from "../src/migrate.js";
import { createUser } from "../src/repositories/users.js";
import { issueToken } from "../src/middleware/auth.js";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { addCredits, getCreditSummary } from "../src/billing/credits.js";
import { membershipPackages } from "../src/billing/terms.js";
import {
  applyBillingEvent,
  ensureCustomer,
  getBilling,
  packagePrice,
  purchaseMetadata,
  startCheckout,
} from "../src/billing/stripe.js";

let f: Awaited<ReturnType<typeof temporaryPostgres>>,
  server: Server,
  url: string;
const authSecret = "billing-test-secret-at-least-32-characters";
const envKeys = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MEMBERSHIP_PRICE_ID",
  "STRIPE_EXTRA_PRICE_ID",
  "BILLING_RETURN_URL",
];
const oldEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
before(async () => {
  f = await temporaryPostgres();
  await migrate(f.db);
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
  process.env.STRIPE_MEMBERSHIP_PRICE_ID = "price_membership";
  process.env.STRIPE_EXTRA_PRICE_ID = "price_extra";
  process.env.BILLING_RETURN_URL = "http://127.0.0.1:3001/api/billing/return";
  server = createApp(
    f.db,
    configFromEnv({ DATABASE_URL: f.url, JWT_SECRET: authSecret }),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  await f?.close();
  for (const key of envKeys) {
    if (oldEnv[key] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
});
async function fixture() {
  const user = await createUser(
      f.db,
      "Billing QA",
      `${randomUUID()}@example.test`,
      "test-password",
    ),
    customer = `cus_${randomUUID()}`;
  await f.db.query(
    "INSERT INTO billing_accounts(user_id,stripe_customer_id) VALUES ($1,$2)",
    [user.id, customer],
  );
  const event = (type: string, object: object, id = `evt_${randomUUID()}`) =>
    ({
      id,
      type,
      livemode: false,
      data: { object: { customer, ...object } },
    }) as Stripe.Event;
  return { user, customer, event };
}
const sub = (status = "active") => ({
  id: "sub_fixture",
  status,
  metadata: { postorca_package: "membership" },
});
function fakeStripe(
  state: {
    subscriptions?: any[];
    session?: any;
    invoice?: any;
    lines?: any[];
    open?: any[];
    create?: (args: any) => any;
    price?: any;
  } = {},
) {
  return {
    prices: {
      retrieve: async (id: string) =>
        state.price ?? {
          id,
          active: true,
          livemode: false,
          currency: "usd",
          unit_amount: id === "price_extra" ? 1000 : 2000,
          billing_scheme: "per_unit",
          recurring:
            id === "price_extra"
              ? null
              : {
                  interval: "month",
                  interval_count: 1,
                  usage_type: "licensed",
                },
        },
    },
    subscriptions: {
      list: async () => ({ data: state.subscriptions ?? [], has_more: false }),
    },
    checkout: {
      sessions: {
        list: async () => ({ data: state.open ?? [], has_more: false }),
        create: async (args: any) =>
          state.create?.(args) ?? {
            id: "cs_new",
            url: "https://checkout.stripe.com/test",
            ...args,
          },
        retrieve: async () => state.session,
        listLineItems: async () => ({
          data: state.lines ?? [],
          has_more: false,
        }),
      },
    },
    invoices: {
      retrieve: async () => state.invoice,
      listLineItems: async function* () {
        for (const line of state.lines ?? []) yield line;
      },
    },
  } as unknown as Stripe;
}
function paidInvoice(userId: string, customer: string, start = 1) {
  return {
    invoice: {
      id: `in_${start}`,
      livemode: false,
      customer,
      status: "paid",
      billing_reason: "subscription_cycle",
      currency: "usd",
      amount_paid: 2000,
      parent: {
        subscription_details: {
          metadata: purchaseMetadata("membership", "price_membership", userId),
          subscription: `sub_${userId}`,
        },
      },
    },
    lines: [
      {
        pricing: { price_details: { price: "price_membership" } },
        parent: {
          subscription_item_details: {
            subscription: `sub_${userId}`,
            proration: false,
          },
        },
        quantity: 1,
        amount: 2000,
        period: { start, end: start + 100 },
      },
    ],
    subscriptions: [{ ...sub(), id: `sub_${userId}` }],
  };
}

test("offers preserve the reference allowance; Stripe prices must exactly match", async () => {
  assert.equal(membershipPackages.membership.amount, 2000);
  assert.equal(membershipPackages.membership.credits, 500);
  assert.equal(membershipPackages.extra.amount, 1000);
  assert.equal(membershipPackages.extra.credits, 250);
  await packagePrice(fakeStripe(), "membership");
  await packagePrice(fakeStripe(), "extra");
  for (const override of [
    { currency: "eur" },
    { unit_amount: 1999 },
    { livemode: true },
    {
      recurring: {
        interval: "year",
        interval_count: 1,
        usage_type: "licensed",
      },
    },
  ]) {
    const price = await fakeStripe().prices.retrieve("price_membership");
    await assert.rejects(
      packagePrice(
        fakeStripe({ price: { ...price, ...override } }),
        "membership",
      ),
      /match the published package/,
    );
  }
});
test("customer creation uses app-scoped idempotency and never substitutes another user's customer", async () => {
  const user = await createUser(
    f.db,
    "New billing",
    `${randomUUID()}@example.test`,
    "test-password",
  );
  let calls = 0;
  const stripe = {
    customers: {
      create: async (args: any, opts: any) => {
        calls++;
        assert.equal(args.metadata.userId, user.id);
        assert.equal(opts.idempotencyKey, `postorca-customer:${user.id}`);
        return { id: `cus_${user.id}` };
      },
    },
  } as unknown as Stripe;
  const one = await ensureCustomer(f.db, stripe, user),
    two = await ensureCustomer(f.db, stripe, user);
  assert.equal(one, two);
  assert.equal(calls, 1);
});
test("checkout snapshots server terms, reuses open sessions and blocks duplicate active subscriptions", async () => {
  const { user } = await fixture();
  let created = 0;
  const open: any[] = [];
  const stripe = fakeStripe({
    open,
    create: (args) => {
      created++;
      assert.equal(args.line_items[0].quantity, 1);
      assert.equal(args.metadata.postorca_credits, "500");
      assert.equal(args.subscription_data.metadata.postorca_amount, "2000");
      const session = {
        ...args,
        id: "cs_once",
        url: "https://checkout.stripe.com/once",
      };
      open.push(session);
      return session;
    },
  });
  const results = await Promise.all([
    startCheckout(f.db, stripe, user, "membership"),
    startCheckout(f.db, stripe, user, "membership"),
  ]);
  assert.equal(created, 1);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(
    startCheckout(
      f.db,
      fakeStripe({ subscriptions: [sub("past_due")] }),
      user,
      "membership",
    ),
    /already have a subscription/,
  );
  await startCheckout(
    f.db,
    fakeStripe({ subscriptions: [sub()] }),
    user,
    "extra",
  );
});
test("paid renewal grants once per period across duplicate and reordered events; no grant on subscription checkout", async () => {
  const { user, customer, event } = await fixture(),
    state = paidInvoice(user.id, customer);
  const stripe = fakeStripe(state),
    invoiceEvent = event("invoice.paid", { id: "in_1" });
  await Promise.all([
    applyBillingEvent(f.db, invoiceEvent, stripe),
    applyBillingEvent(f.db, invoiceEvent, stripe),
  ]);
  await applyBillingEvent(f.db, event("invoice.paid", { id: "in_1" }), stripe);
  assert.equal((await getCreditSummary(f.db, user.id)).balance, 750);
  await applyBillingEvent(
    f.db,
    event("checkout.session.completed", { id: "cs_sub", mode: "subscription" }),
    stripe,
  );
  assert.equal((await getCreditSummary(f.db, user.id)).balance, 750);
  const renewal = paidInvoice(user.id, customer, 200);
  await applyBillingEvent(
    f.db,
    event("invoice.paid", { id: "in_200" }),
    fakeStripe(renewal),
  );
  assert.equal((await getCreditSummary(f.db, user.id)).balance, 1250);
  state.subscriptions = [sub("canceled")];
  await applyBillingEvent(
    f.db,
    event("customer.subscription.updated", {
      id: "sub_fixture",
      status: "active",
    }),
    stripe,
  );
  assert.equal((await getBilling(f.db, user.id))?.status, "canceled");
});
test("top-ups grant only paid, owner-bound, exact line items and deduplicate async payment notifications", async () => {
  const { user, customer, event } = await fixture();
  const state = {
    session: {
      id: "cs_pack",
      customer,
      livemode: false,
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      currency: "usd",
      amount_total: 1000,
      client_reference_id: user.id,
      metadata: purchaseMetadata("extra", "price_extra", user.id),
    },
    lines: [{ price: { id: "price_extra" }, quantity: 1, amount_total: 1000 }],
  };
  const stripe = fakeStripe(state);
  await applyBillingEvent(
    f.db,
    event("checkout.session.completed", { id: "cs_pack", mode: "payment" }),
    stripe,
  );
  await applyBillingEvent(
    f.db,
    event("checkout.session.async_payment_succeeded", {
      id: "cs_pack",
      mode: "payment",
    }),
    stripe,
  );
  assert.equal((await getCreditSummary(f.db, user.id)).balance, 500);
  state.session.client_reference_id = randomUUID();
  const invalid = event("checkout.session.completed", {
    id: "cs_pack",
    mode: "payment",
  });
  await assert.rejects(
    applyBillingEvent(f.db, invalid, stripe),
    /does not match/,
  );
  assert.equal(
    (await f.db.query("SELECT * FROM stripe_events WHERE id=$1", [invalid.id]))
      .rowCount,
    0,
  );
});
test("bad paid invoices roll back event processing, unpaid invoices grant nothing, and historical purchase terms stay valid", async () => {
  const { user, customer, event } = await fixture(),
    state = paidInvoice(user.id, customer);
  state.lines[0].quantity = 2;
  const invalid = event("invoice.paid", { id: "in_1" });
  await assert.rejects(
    applyBillingEvent(f.db, invalid, fakeStripe(state)),
    /complete subscription allowance/,
  );
  assert.equal(
    (await f.db.query("SELECT * FROM stripe_events WHERE id=$1", [invalid.id]))
      .rowCount,
    0,
  );
  state.lines[0].quantity = 1;
  state.invoice.status = "open";
  await applyBillingEvent(
    f.db,
    event("invoice.paid", { id: "in_1" }),
    fakeStripe(state),
  );
  assert.equal((await getCreditSummary(f.db, user.id)).balance, 250);
  state.invoice.status = "paid";
  state.invoice.parent.subscription_details.metadata.postorca_credits = "600";
  await applyBillingEvent(f.db, invalid, fakeStripe(state));
  assert.equal((await getCreditSummary(f.db, user.id)).balance, 850);
  await assert.rejects(
    applyBillingEvent(f.db, { ...invalid, livemode: true }, fakeStripe(state)),
    /Only Stripe test/,
  );
});
test("billing HTTP routes isolate accounts, disable unconfigured payments, verify raw webhook signatures and grant nothing on return", async () => {
  const { user } = await fixture();
  delete process.env.STRIPE_MEMBERSHIP_PRICE_ID;
  delete process.env.STRIPE_EXTRA_PRICE_ID;
  const headers = {
    Authorization: `Bearer ${issueToken(user.id, authSecret)}`,
    "Content-Type": "application/json",
  };
  assert.equal((await fetch(`${url}/api/billing`)).status, 401);
  const response = await fetch(`${url}/api/billing`, { headers });
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const data: any = await response.json();
  assert.equal(data.configured, false);
  assert.equal(data.credits.balance, 250);
  assert.equal(
    (
      await fetch(`${url}/api/billing/checkout`, {
        method: "POST",
        headers,
        body: JSON.stringify({ packageId: "extra" }),
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await fetch(`${url}/api/billing/checkout`, {
        method: "POST",
        headers,
        body: JSON.stringify({ packageId: "extra", credits: 100000 }),
      })
    ).status,
    400,
  );
  const event = JSON.stringify({
    id: "evt_raw_test",
    type: "customer.created",
    livemode: false,
    data: { object: {} },
  });
  const stripe = new Stripe("sk_test_fixture");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: event,
    secret: "whsec_fixture",
  });
  assert.equal(
    (
      await fetch(`${url}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": signature,
        },
        body: event,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${url}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": signature,
        },
        body: event + " ",
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(`${url}/api/billing/return?checkout=success`)).status,
    200,
  );
  assert.equal((await getCreditSummary(f.db, user.id)).balance, 250);
});

test("operators add credits by email, on top of the welcome credits", async () => {
  const email = `${randomUUID()}@example.test`;
  const user = await createUser(f.db, "Top up", email, "test-password");
  const added = await addCredits(f.db, email.toUpperCase(), "100");
  assert.equal(added.userId, user.id);
  assert.equal(added.balance, 350);
  assert.equal((await addCredits(f.db, email, "0.5")).balance, 350.5);
  await assert.rejects(addCredits(f.db, email, "0"), /positive/);
  await assert.rejects(addCredits(f.db, "nobody@example.test", "10"), /No account/);
});
