import Stripe from "stripe";
import { transaction, type Database, type Queryable } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import { creditTerms, membershipPackages, type PackageId } from "./terms.js";

// Test-only rollout: no live charges are enabled.
export const activeStatuses = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);
export function stripeConfigured(packageId: PackageId = "membership") {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") &&
      process.env.STRIPE_WEBHOOK_SECRET &&
      (packageId === "membership"
        ? process.env.STRIPE_MEMBERSHIP_PRICE_ID
        : process.env.STRIPE_EXTRA_PRICE_ID),
  );
}
export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw new HttpError(503, "Test billing is not configured yet.");
  return new Stripe(key);
}
export function billingReturnUrl() {
  const value =
    process.env.BILLING_RETURN_URL ??
    "http://127.0.0.1:3001/api/billing/return";
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname))
    )
  )
    throw new HttpError(503, "Billing return URL is not configured correctly.");
  return url.href;
}
export async function packagePrice(stripe: Stripe, packageId: PackageId) {
  const id =
    packageId === "membership"
      ? process.env.STRIPE_MEMBERSHIP_PRICE_ID
      : process.env.STRIPE_EXTRA_PRICE_ID;
  if (!id)
    throw new HttpError(503, "Membership pricing has not been configured yet.");
  const price = await stripe.prices.retrieve(id),
    offer = membershipPackages[packageId];
  if (
    price.livemode ||
    !price.active ||
    price.currency !== creditTerms.currency ||
    price.unit_amount !== offer.amount ||
    price.billing_scheme !== "per_unit" ||
    (packageId === "membership"
      ? !price.recurring ||
        price.recurring.interval !== "month" ||
        price.recurring.interval_count !== 1 ||
        price.recurring.usage_type !== "licensed"
      : Boolean(price.recurring))
  )
    throw new HttpError(
      503,
      `Configure the ${offer.name} Stripe test price to match the published package.`,
    );
  return price;
}
export function purchaseMetadata(
  packageId: PackageId,
  priceId: string,
  userId: string,
) {
  const offer = membershipPackages[packageId];
  return {
    userId,
    postorca_package: packageId,
    postorca_version: creditTerms.version,
    postorca_price: priceId,
    postorca_credits: String(offer.credits),
    postorca_amount: String(offer.amount),
    postorca_usd_per_credit: creditTerms.usdPerCredit,
  };
}
function purchaseTerms(
  metadata: Stripe.Metadata | null,
  userId: string,
  packageId: PackageId,
) {
  if (!metadata?.postorca_package) return null;
  if (
    metadata.postorca_package !== packageId ||
    metadata.userId !== userId ||
    !metadata.postorca_version ||
    !metadata.postorca_price ||
    !/^\d+$/.test(metadata.postorca_credits ?? "") ||
    !/^\d+$/.test(metadata.postorca_amount ?? "") ||
    Number(metadata.postorca_credits) <= 0 ||
    Number(metadata.postorca_credits) > 1_000_000 ||
    Number(metadata.postorca_amount) <= 0 ||
    Number(metadata.postorca_amount) > 100_000_000
  )
    throw new Error("Invalid credit purchase metadata.");
  return {
    credits: Number(metadata.postorca_credits),
    amount: Number(metadata.postorca_amount),
    priceId: metadata.postorca_price,
  };
}
const objectId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
async function grantInvoice(
  db: Queryable,
  stripe: Stripe,
  invoiceId: string,
  customerId: string,
  userId: string,
) {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (
    invoice.livemode ||
    objectId(invoice.customer) !== customerId ||
    invoice.status !== "paid" ||
    !["subscription_create", "subscription_cycle"].includes(
      invoice.billing_reason ?? "",
    )
  )
    return;
  const details = invoice.parent?.subscription_details;
  const terms = purchaseTerms(details?.metadata ?? null, userId, "membership");
  if (!terms || !details) return;
  if (
    invoice.currency !== creditTerms.currency ||
    invoice.amount_paid < terms.amount
  )
    throw new Error("Paid invoice does not match its credit package.");
  const lines: Stripe.InvoiceLineItem[] = [];
  for await (const line of stripe.invoices.listLineItems(invoice.id, {
    limit: 100,
  })) {
    const item = line.parent?.subscription_item_details;
    if (
      objectId(line.pricing?.price_details?.price) === terms.priceId &&
      item?.subscription === objectId(details.subscription) &&
      item &&
      !item.proration &&
      line.quantity === 1 &&
      line.amount === terms.amount
    )
      lines.push(line);
  }
  if (lines.length !== 1)
    throw new Error(
      "Invoice must contain one complete subscription allowance.",
    );
  const period = lines[0].period;
  await db.query(
    `INSERT INTO credit_ledger(user_id,amount,description,reference) VALUES ($1,$2,'Monthly allowance',$3) ON CONFLICT (reference) DO NOTHING`,
    [
      userId,
      terms.credits,
      `stripe:period:${objectId(details.subscription)}:${period.start}:${period.end}`,
    ],
  );
}
async function grantPack(
  db: Queryable,
  stripe: Stripe,
  sessionId: string,
  customerId: string,
  userId: string,
) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (
    session.livemode ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    objectId(session.customer) !== customerId
  )
    return;
  const terms = purchaseTerms(session.metadata, userId, "extra");
  if (!terms) return;
  const items = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 100,
  });
  if (
    session.client_reference_id !== userId ||
    session.currency !== creditTerms.currency ||
    session.amount_total !== terms.amount ||
    items.has_more ||
    items.data.length !== 1 ||
    items.data[0].price?.id !== terms.priceId ||
    items.data[0].quantity !== 1 ||
    items.data[0].amount_total !== terms.amount
  )
    throw new Error("Paid checkout does not match its credit package.");
  await db.query(
    `INSERT INTO credit_ledger(user_id,amount,description,reference) VALUES ($1,$2,'Extra credit pack',$3) ON CONFLICT (reference) DO NOTHING`,
    [userId, terms.credits, `stripe:checkout:${session.id}`],
  );
}
export async function getBilling(db: Queryable, userId: string) {
  const {
    rows: [row],
  } = await db.query(
    `SELECT stripe_customer_id AS "customerId",stripe_subscription_id AS "subscriptionId",subscription_status AS status FROM billing_accounts WHERE user_id=$1`,
    [userId],
  );
  return row as
    | { customerId: string; subscriptionId: string | null; status: string }
    | undefined;
}
export async function ensureCustomer(
  db: Database,
  stripe: Stripe,
  user: { id: string; email: string; name: string },
) {
  const existing = await getBilling(db, user.id);
  if (existing) return existing.customerId;
  const customer = await stripe.customers.create(
    { email: user.email, name: user.name, metadata: { userId: user.id } },
    { idempotencyKey: `postorca-customer:${user.id}` },
  );
  await db.query(
    "INSERT INTO billing_accounts(user_id,stripe_customer_id) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING",
    [user.id, customer.id],
  );
  return (await getBilling(db, user.id))!.customerId;
}
async function subscriptionsFor(stripe: Stripe, customer: string) {
  const result = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 100,
  });
  if (result.has_more)
    throw new Error("Billing subscription list requires reconciliation.");
  return result.data.filter(
    (s) => s.metadata?.postorca_package === "membership",
  );
}
export async function applyBillingEvent(
  db: Database,
  event: Stripe.Event,
  stripe: Stripe,
) {
  if (event.livemode)
    throw new HttpError(400, "Only Stripe test events are accepted.");
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed",
      "invoice.paid",
      "invoice.payment_failed",
    ].includes(event.type)
  )
    return;
  const object = event.data.object as
    | Stripe.Subscription
    | Stripe.Checkout.Session
    | Stripe.Invoice;
  const customerId = objectId(object.customer);
  if (!customerId) return;
  await transaction(db, async (client) => {
    const {
      rows: [owner],
    } = await client.query(
      "SELECT user_id FROM billing_accounts WHERE stripe_customer_id=$1 FOR UPDATE",
      [customerId],
    );
    if (!owner) return;
    const inserted = await client.query(
      "INSERT INTO stripe_events(id,type) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING",
      [event.id, event.type],
    );
    if (!inserted.rowCount) return;
    const userId = owner.user_id as string;
    if (event.type === "invoice.paid")
      await grantInvoice(client, stripe, object.id, customerId, userId);
    if (
      event.type.startsWith("checkout.session.") &&
      (object as Stripe.Checkout.Session).mode === "payment"
    )
      await grantPack(client, stripe, object.id, customerId, userId);
    // Current upstream state wins over out-of-order webhook delivery.
    const subs = await subscriptionsFor(stripe, customerId);
    const current = subs.find((s) => activeStatuses.has(s.status)) ?? subs[0];
    await client.query(
      `UPDATE billing_accounts SET stripe_subscription_id=$2,subscription_status=$3,updated_at=clock_timestamp() WHERE stripe_customer_id=$1`,
      [customerId, current?.id ?? null, current?.status ?? "none"],
    );
  });
}
export async function startCheckout(
  db: Database,
  stripe: Stripe,
  user: { id: string; email: string; name: string },
  packageId: PackageId,
) {
  const price = await packagePrice(stripe, packageId),
    customer = await ensureCustomer(db, stripe, user);
  return transaction(db, async (client) => {
    await client.query(
      "SELECT user_id FROM billing_accounts WHERE user_id=$1 FOR UPDATE",
      [user.id],
    );
    if (
      packageId === "membership" &&
      (await subscriptionsFor(stripe, customer)).some((s) =>
        activeStatuses.has(s.status),
      )
    )
      throw new HttpError(
        409,
        "You already have a subscription. Manage it from Billing & Usage.",
      );
    const sessions = await stripe.checkout.sessions.list({
      customer,
      status: "open",
      limit: 100,
    });
    if (sessions.has_more)
      throw new Error("Billing checkout list requires reconciliation.");
    const metadata = purchaseMetadata(packageId, price.id, user.id);
    const matching = sessions.data.find(
      (s) =>
        s.mode === (packageId === "membership" ? "subscription" : "payment") &&
        Object.entries(metadata).every(
          ([key, value]) => s.metadata?.[key] === value,
        ),
    );
    const session =
      matching ??
      (await stripe.checkout.sessions.create({
        mode: packageId === "membership" ? "subscription" : "payment",
        customer,
        line_items: [{ price: price.id, quantity: 1 }],
        client_reference_id: user.id,
        metadata,
        ...(packageId === "membership"
          ? { subscription_data: { metadata } }
          : { payment_intent_data: { metadata } }),
        success_url: billingReturnUrl(),
        cancel_url: billingReturnUrl(),
      }));
    if (!session.url) throw new Error("Checkout returned no URL.");
    return { url: session.url };
  });
}
