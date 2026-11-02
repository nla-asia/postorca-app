import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type Stripe from "stripe";
import type { Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import { findUser } from "../repositories/users.js";
import { settings } from "../settings.js";
import { getCreditSummary } from "../billing/credits.js";
import {
  creditTerms,
  membershipPackages,
  planIds,
  type PackageId,
} from "../billing/terms.js";
import {
  applyBillingEvent,
  billingReturnUrl,
  changePlan,
  getBilling,
  getStripe,
  startCheckout,
  stripeConfigured,
} from "../billing/stripe.js";

export function billingWebhook(db: Database): RequestHandler {
  return async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret)
      throw new HttpError(503, "Test billing is not configured yet.");
    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.get("stripe-signature") ?? "",
        secret,
      );
    } catch {
      throw new HttpError(400, "Invalid Stripe signature.");
    }
    await applyBillingEvent(db, event, stripe);
    res.json({ received: true });
  };
}
export function billingRoutes(db: Database) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get("/", async (_req, res) => {
    const account = await getBilling(db, res.locals.userId);
    res.json({
      available: Object.fromEntries(
        (Object.keys(membershipPackages) as PackageId[]).map((id) => [
          id,
          stripeConfigured(id),
        ]),
      ),
      status: account?.status ?? "none",
      plan: account?.plan ?? null,
      hasCustomer: Boolean(account),
      packages: membershipPackages,
      creditTerms,
      welcomeCredits: settings.welcomeCredits,
      credits: await getCreditSummary(db, res.locals.userId),
    });
  });
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  router.post("/checkout", async (req, res) => {
    const { packageId } = z
      .object({ packageId: z.enum([...planIds, "extra"]) })
      .strict()
      .parse(req.body);
    if (!stripeConfigured(packageId))
      throw new HttpError(503, "Payments are not available yet.");
    const user = await findUser(db, res.locals.userId);
    if (!user) throw new HttpError(401, "Please log in.");
    res.json(await startCheckout(db, getStripe(), user, packageId));
  });
  router.post("/plan", async (req, res) => {
    const { plan } = z
      .object({ plan: z.enum(planIds) })
      .strict()
      .parse(req.body);
    if (!stripeConfigured(plan))
      throw new HttpError(503, "Payments are not available yet.");
    res.json(await changePlan(db, getStripe(), res.locals.userId, plan));
  });
  router.post("/portal", async (_req, res) => {
    const account = await getBilling(db, res.locals.userId);
    if (!account)
      throw new HttpError(404, "There is no billing account to manage yet.");
    const session = await getStripe().billingPortal.sessions.create({
      customer: account.customerId,
      return_url: billingReturnUrl(),
    });
    res.json({ url: session.url });
  });
  return router;
}
export const billingReturn: RequestHandler = (_req, res) => {
  res
    .set("Cache-Control", "no-store")
    .type("html")
    .send(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PostOrca billing</title><body style="font-family:system-ui;max-width:36rem;margin:15vh auto;padding:2rem"><h1>Return to PostOrca</h1><p>You can close this tab and open Settings → Account → Billing &amp; Usage in PostOrca.</p><p>Confirmed payments appear there automatically. If you completed checkout, your credits may take a moment to arrive.</p></body></html>`,
    );
};
