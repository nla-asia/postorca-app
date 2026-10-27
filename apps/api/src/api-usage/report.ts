import { z } from "zod";
import type { Queryable } from "../db.js";

export const reportOptions = z
  .object({
    user: z.uuid().optional(),
    task: z.uuid().optional(),
    turn: z.uuid().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export async function apiUsageReport(
  db: Queryable,
  input: z.input<typeof reportOptions> = {},
) {
  const options = reportOptions.parse(input);
  if (
    options.from &&
    options.to &&
    Date.parse(options.from) >= Date.parse(options.to)
  )
    throw new Error("from must precede to");
  const where: string[] = [],
    values: string[] = [];
  for (const [key, column, operator] of [
    ["user", "user_id", "="],
    ["task", "task_id", "="],
    ["turn", "turn_id", "="],
    ["from", "started_at", ">="],
    ["to", "started_at", "<"],
  ] as const) {
    if (options[key]) {
      values.push(options[key]);
      where.push(`${column} ${operator} $${values.length}`);
    }
  }
  return (
    await db.query(
      `SELECT provider,model,operation,estimated_currency AS currency,
    count(*)::int AS attempts,
    count(*) FILTER (WHERE retry_count > 0)::int AS retries,
    count(*) FILTER (WHERE status='succeeded')::int AS succeeded,
    count(*) FILTER (WHERE status='failed')::int AS failed,
    count(*) FILTER (WHERE status='interrupted')::int AS interrupted,
    count(*) FILTER (WHERE status='started')::int AS unfinished,
    count(*) FILTER (WHERE estimated_cost IS NULL)::int AS unknown_cost,
    sum(estimated_cost)::text AS estimated_cost,
    sum((usage_data->'meters'->>'input_tokens')::numeric)::text AS input_tokens,
    sum((usage_data->'meters'->>'cached_input_tokens')::numeric)::text AS cached_input_tokens,
    sum((usage_data->'meters'->>'cache_write_tokens')::numeric)::text AS cache_write_tokens,
    sum((usage_data->'meters'->>'output_tokens')::numeric)::text AS output_tokens,
    sum(duration_ms)::text AS duration_ms
    FROM api_requests ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY provider,model,operation,estimated_currency ORDER BY provider,model,operation,estimated_currency`,
      values,
    )
  ).rows;
}
