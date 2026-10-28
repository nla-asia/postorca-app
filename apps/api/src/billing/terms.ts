import { settings } from "../settings.js";
// Membership and credit terms. Snapshot terms before purchases and usage.
// One credit buys usdPerCredit of real AI cost; usage is charged at that rate,
// rounded up to a whole credit once per Orca turn.
export const creditTerms = {
  version: "2026-10-28",
  currency: "usd",
  usdPerCredit: "0.04",
} as const;
/** Credits bought by the part of a price that goes to AI usage; the rest covers
 * servers, payment fees and running PostOrca. */
const creditsFor = (usageCents: number) =>
  Math.round(usageCents / (Number(creditTerms.usdPerCredit) * 100));
export const membershipPackages = {
  builder: {
    id: "builder",
    name: "Builder",
    amount: 2900,
    credits: creditsFor(2000),
    interval: "month",
  },
  influencer: {
    id: "influencer",
    name: "Influencer",
    amount: 6900,
    credits: creditsFor(6000),
    interval: "month",
  },
  extra: {
    id: "extra",
    name: "Extra credits",
    amount: 1000,
    credits: creditsFor(800),
    interval: null,
  },
} as const;
export type PackageId = keyof typeof membershipPackages;
export const planIds = ["builder", "influencer"] as const;
export type PlanId = (typeof planIds)[number];
export const isPlan = (value: unknown): value is PlanId =>
  planIds.includes(value as PlanId);
export function welcomeCredits() {
  return settings.welcomeCredits;
}
