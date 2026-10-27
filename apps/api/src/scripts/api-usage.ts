import "../env.js";
import { z } from "zod";
import { createDatabase } from "../db.js";
import { recoverApiUsage } from "../api-usage/ledger.js";
import { apiUsageReport, reportOptions } from "../api-usage/report.js";
import { reconcileApiCredits } from "../billing/credits.js";

const [command = "report", ...args] = process.argv.slice(2);
const options: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    !args[i]?.startsWith("--") ||
    !args[i + 1] ||
    args[i + 1].startsWith("--") ||
    args[i].slice(2) in options
  )
    throw new Error("Use unique --option value pairs.");
  options[args[i].slice(2)] = args[i + 1];
}
const reconciliation = z
  .object({
    id: z.uuid(),
    cost: z.string().regex(/^\d{1,12}(?:\.\d{1,12})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    source: z.string().trim().min(1).max(255),
  })
  .strict();
if (command === "report") reportOptions.parse(options);
else if (command === "recover") {
  if (args.length) throw new Error("recover takes no filters.");
} else if (command === "reconcile") reconciliation.parse(options);
else throw new Error("Use report, recover or reconcile.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const db = createDatabase(process.env.DATABASE_URL);
try {
  await recoverApiUsage(db);
  if (command === "report")
    console.log(JSON.stringify(await apiUsageReport(db, options), null, 2));
  else if (command === "reconcile") {
    await reconcileApiCredits(db, reconciliation.parse(options));
    console.log(
      "Provider charge recorded; credits reconciled without rewriting the estimate.",
    );
  } else console.log("API usage recovery complete.");
} finally {
  await db.end();
}
