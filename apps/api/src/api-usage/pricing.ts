import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PROVIDER_PRICING } from "../providers/pricing.js";

export const rateSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  operation: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  effectiveFrom: z.iso.datetime(),
  effectiveTo: z.iso.datetime().optional(),
  settings: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  meterRanges: z
    .record(
      z.string(),
      z.object({
        min: z.number().nonnegative().optional(),
        max: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
  prices: z
    .array(
      z.object({
        meter: z.string().min(1),
        amount: z.string().regex(/^\d{1,12}(?:\.\d{1,12})?$/),
        perUnits: z.number().int().positive().max(1_000_000_000),
        roundUpTo: z.number().min(0.000000000001).max(1_000_000_000).optional(),
      }),
    )
    .min(1),
});
export type PriceRate = z.infer<typeof rateSchema>;
const scale = 1_000_000_000_000n;
function decimal(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0"));
}
export function money(value: bigint) {
  return `${value / scale}.${(value % scale).toString().padStart(12, "0")}`;
}
/** Fixed-point decimal arithmetic; never mix credits, currencies or missing meters. */
export function estimateCost(
  rate: PriceRate,
  meters: Record<string, number>,
): string | null {
  let total = 0n;
  for (const price of rate.prices) {
    const quantity = meters[price.meter];
    if (quantity === undefined || !Number.isFinite(quantity) || quantity < 0)
      return null;
    if (!Number.isSafeInteger(Math.trunc(quantity))) return null;
    let units = decimal(quantity.toFixed(12));
    if (price.roundUpTo) {
      const increment = decimal(price.roundUpTo.toFixed(12));
      units = ((units + increment - 1n) / increment) * increment;
    }
    const denominator = scale * BigInt(price.perUnits);
    total += (units * decimal(price.amount) + denominator / 2n) / denominator;
  }
  return total >= 1_000_000_000_000n * scale ? null : money(total);
}
export async function loadRates(
  path = process.env.API_PRICING_FILE,
): Promise<PriceRate[]> {
  if (!path)
    return z
      .array(rateSchema)
      .parse(PROVIDER_PRICING.filter((rate) => rate.enabled));
  return z.array(rateSchema).parse(JSON.parse(await readFile(path, "utf8")));
}
export function matchRate(
  rates: PriceRate[],
  request: {
    provider: string;
    model: string;
    operation: string;
    settings: Record<string, unknown>;
    startedAt: Date;
    meters?: Record<string, number>;
  },
) {
  const matches = rates.filter(
    (r) =>
      r.provider === request.provider &&
      r.model === request.model &&
      r.operation === request.operation &&
      Date.parse(r.effectiveFrom) <= request.startedAt.getTime() &&
      (!r.effectiveTo ||
        request.startedAt.getTime() < Date.parse(r.effectiveTo)) &&
      Object.entries(r.settings).every(
        ([key, value]) => request.settings[key] === value,
      ) &&
      Object.entries(r.meterRanges ?? {}).every(([key, range]) => {
        const value = request.meters?.[key];
        return (
          value !== undefined &&
          (range.min === undefined || value >= range.min) &&
          (range.max === undefined || value <= range.max)
        );
      }),
  );
  if (matches.length > 1)
    throw new Error(
      "Ambiguous API pricing: more than one rate matches a request.",
    );
  return matches[0];
}
