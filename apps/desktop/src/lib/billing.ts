/** What the billing panel needs to tell whether a payment made in Stripe has arrived. */
export type BillingState = {
  status: string;
  plan: string | null;
  packages: Record<string, { name: string; credits: number }>;
  credits: { entries: { id: string; amount: number }[] };
};
export type BillingAction = "builder" | "influencer" | "extra" | "portal";
export type Baseline = { status: string; plan: string | null; grants: string[] };

/** Subscriptions that count as paid for. */
const paid = new Set(["active", "trialing"]);

export const baselineOf = (state: BillingState): Baseline => ({
  status: state.status,
  plan: state.plan,
  grants: state.credits.entries
    .filter((entry) => entry.amount > 0)
    .map((entry) => entry.id),
});

/**
 * Stripe confirms payments by webhook a moment after checkout, so the panel watches
 * for the change. Returns what to tell the founder once it has landed, else null.
 */
export function paymentLanded(
  action: BillingAction,
  before: Baseline,
  now: BillingState,
): string | null {
  if (action === "extra") {
    const grant = now.credits.entries.find(
      (entry) => entry.amount > 0 && !before.grants.includes(entry.id),
    );
    return grant
      ? `Payment received. ${now.packages.extra.credits} credits were added to your balance.`
      : null;
  }
  if (action === "portal")
    return now.status !== before.status || now.plan !== before.plan
      ? "Your subscription changes are saved."
      : null;
  const changed =
    now.plan !== before.plan ||
    (paid.has(now.status) && !paid.has(before.status));
  return paid.has(now.status) && now.plan === action && changed
    ? `Payment received. You're on the ${now.packages[action].name} plan.`
    : null;
}
