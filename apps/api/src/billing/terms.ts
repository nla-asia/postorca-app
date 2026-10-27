// Membership and credit terms. Snapshot terms before purchases and usage.
export const creditTerms = {
  version: "2026-10-27",
  currency: "usd",
  usdPerCredit: "0.03",
} as const;
export const membershipPackages = {
  membership: {
    id: "membership",
    name: "PostOrca",
    amount: 2000,
    credits: 500,
    interval: "month",
  },
  extra: {
    id: "extra",
    name: "Extra credits",
    amount: 1000,
    credits: 250,
    interval: null,
  },
} as const;
export type PackageId = keyof typeof membershipPackages;
export function welcomeCredits() {
  const value = Number(process.env.WELCOME_CREDITS ?? 250);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("WELCOME_CREDITS must be a non-negative integer.");
  return value;
}
