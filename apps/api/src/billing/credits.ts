import { transaction, type Database, type Queryable } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import { creditTerms, welcomeCredits } from "./terms.js";
import { requestReservation } from "./reservations.js";

export class CreditError extends HttpError {
  constructor(
    public code:
      "insufficient_credits" | "credit_configuration" | "credit_account",
  ) {
    super(
      402,
      code === "insufficient_credits"
        ? "Not enough credits. Add credits in Settings → Account → Billing & Usage to continue."
        : "Generation is temporarily unavailable. Please try again later.",
    );
  }
}
const scale = 1_000_000_000n;
export function units(value: string | number) {
  const text = String(value);
  if (!/^-?\d+(?:\.\d{1,12})?$/.test(text))
    throw new Error("Invalid credit amount.");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const n = BigInt(whole) * scale + BigInt(fraction.padEnd(9, "0").slice(0, 9));
  return text.startsWith("-") ? -n : n;
}
export function amount(value: bigint) {
  const n = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${n / scale}.${(n % scale).toString().padStart(9, "0")}`;
}
export function costToCredits(
  cost: string,
  usdPerCredit: string = creditTerms.usdPerCredit,
) {
  const decimal = (v: string) => {
    if (!/^\d+(?:\.\d{1,12})?$/.test(v)) throw new Error("Invalid USD amount.");
    const [w, f = ""] = v.split(".");
    return BigInt(w) * 1_000_000_000_000n + BigInt(f.padEnd(12, "0"));
  };
  const denominator = decimal(usdPerCredit);
  if (denominator <= 0n) throw new Error("Invalid credit conversion.");
  return amount((decimal(cost) * scale + denominator - 1n) / denominator);
}
export async function ensureWelcomeCredits(db: Queryable, userId: string) {
  await db.query(
    `INSERT INTO credit_ledger(user_id,amount,description,reference)
    VALUES ($1,$2,'Welcome credits',$3) ON CONFLICT (reference) DO NOTHING`,
    [userId, welcomeCredits(), `welcome:${userId}`],
  );
}
async function account<T>(
  db: Database,
  userId: string,
  work: (client: Queryable) => Promise<T>,
) {
  return transaction(db, async (client) => {
    const user = await client.query(
      "SELECT id FROM users WHERE id=$1 FOR UPDATE",
      [userId],
    );
    if (!user.rowCount) throw new CreditError("credit_account");
    await ensureWelcomeCredits(client, userId);
    return work(client);
  });
}
async function available(db: Queryable, userId: string) {
  const {
    rows: [r],
  } = await db.query(
    `SELECT
    COALESCE((SELECT sum(amount) FROM credit_ledger WHERE user_id=$1),0) AS posted,
    COALESCE((SELECT sum(credit_reserved) FROM api_requests WHERE user_id=$1 AND credit_state IN ('reserved','pending')),0) AS held`,
    [userId],
  );
  return units(r.posted) - units(r.held);
}
export const creditDescription = (operation: string) =>
  ({
    responses: "Orca",
    "image.generate": "Image generation",
    "image.edit": "Image editing",
    speech: "Speech",
    music: "Music",
    sound_effect: "Sound effects",
    transcription: "Transcription",
  })[operation] ?? "AI usage";
/** Rounds a positive amount up to the next whole credit. */
export function wholeCredits(value: bigint) {
  return value <= 0n ? 0n : ((value + scale - 1n) / scale) * scale;
}
/** A turn (or a request outside any turn) has one ledger entry: its settled
 * requests' exact cost in credits, rounded up once. Later settlements and
 * reconciliations rewrite that entry, so rounding never compounds per request. */
async function chargeGroup(
  db: Queryable,
  userId: string,
  group: string,
  operation: string,
) {
  const {
    rows: [usage],
  } = await db.query(
    "SELECT COALESCE(sum(credit_charged),0) AS exact FROM api_requests WHERE user_id=$1 AND credit_group=$2 AND credit_state='settled'",
    [userId, group],
  );
  const charge = wholeCredits(units(usage.exact)),
    reference = `usage:${group}`;
  if (charge === 0n) {
    await db.query("DELETE FROM credit_ledger WHERE reference=$1", [reference]);
    return;
  }
  const {
    rows: [task],
  } = group.startsWith("turn:")
    ? await db.query(
        "SELECT tasks.title FROM turns JOIN tasks ON tasks.id=turns.task_id WHERE turns.id=$1",
        [group.slice("turn:".length)],
      )
    : { rows: [] };
  await db.query(
    `INSERT INTO credit_ledger(user_id,amount,description,reference) VALUES ($1,$2,$3,$4)
    ON CONFLICT (reference) DO UPDATE SET amount=EXCLUDED.amount`,
    [
      userId,
      amount(-charge),
      task?.title ? `Orca: ${task.title}` : creditDescription(operation),
      reference,
    ],
  );
}
async function settle(db: Queryable, row: Record<string, any>) {
  if (!row.credit_state || ["blocked", "released"].includes(row.credit_state))
    return;
  const cost =
    row.reported_cost !== null
      ? row.reported_currency === "USD"
        ? row.reported_cost
        : null
      : row.estimated_currency === "USD"
        ? row.estimated_cost
        : null;
  if (
    cost !== null &&
    (row.reported_cost !== null ||
      ["succeeded", "failed", "interrupted"].includes(row.status))
  ) {
    const charged = costToCredits(
      String(cost),
      String(row.credit_usd_per_credit),
    );
    const delta = units(charged) - units(row.credit_charged);
    let version = row.credit_version as number;
    if (delta !== 0n) {
      version++;
      if (!row.credit_group)
        await db.query(
          `INSERT INTO credit_ledger(user_id,amount,description,reference) VALUES ($1,$2,$3,$4)`,
          [
            row.user_id,
            amount(-delta),
            creditDescription(row.operation) +
              (delta < 0n ? " adjustment" : ""),
            `api:${row.id}:${version}`,
          ],
        );
    }
    await db.query(
      "UPDATE api_requests SET credit_reserved=0,credit_charged=$2,credit_state='settled',credit_version=$3 WHERE id=$1",
      [row.id, charged, version],
    );
    if (row.credit_group)
      await chargeGroup(db, row.user_id, row.credit_group, row.operation);
  } else if (["failed", "interrupted", "succeeded"].includes(row.status)) {
    // Only explicit non-timeout HTTP rejections release their hold; network/5xx/408 are ambiguous.
    const rejected =
      row.status === "failed" &&
      row.http_status >= 400 &&
      row.http_status < 500 &&
      row.http_status !== 408;
    await db.query(
      "UPDATE api_requests SET credit_state=$2,credit_reserved=CASE WHEN $3 THEN 0 ELSE credit_reserved END WHERE id=$1",
      [row.id, rejected ? "released" : "pending", rejected],
    );
  }
}
async function settleUser(db: Queryable, userId: string) {
  const { rows } = await db.query(
    "SELECT * FROM api_requests WHERE user_id=$1 AND credit_state IN ('reserved','pending') AND status IN ('succeeded','failed','interrupted') ORDER BY started_at,id FOR UPDATE",
    [userId],
  );
  for (const row of rows) await settle(db, row);
}
export async function settleApiCredits(db: Database, requestId: string) {
  const {
    rows: [owner],
  } = await db.query(
    "SELECT user_id FROM api_requests WHERE id=$1 AND credit_state IS NOT NULL",
    [requestId],
  );
  if (!owner?.user_id) return;
  await account(db, owner.user_id, async (client) => {
    const {
      rows: [row],
    } = await client.query(
      "SELECT * FROM api_requests WHERE id=$1 FOR UPDATE",
      [requestId],
    );
    if (row) await settle(client, row);
  });
}
export async function reserveApiCredits(
  db: Database,
  input: {
    id: string;
    userId: string;
    provider: string;
    model: string;
    operation: string;
    args: Record<string, unknown>;
  },
) {
  let reservation;
  try {
    reservation = requestReservation(
      input.provider,
      input.model,
      input.operation,
      input.args,
    );
  } catch {
    throw new CreditError("credit_configuration");
  }
  const snapshot = reservation;
  const enough = await account(db, input.userId, async (client) => {
    await settleUser(client, input.userId);
    const {
      rows: [row],
    } = await client.query(
      "SELECT * FROM api_requests WHERE id=$1 FOR UPDATE",
      [input.id],
    );
    if (!row || row.user_id !== input.userId)
      throw new CreditError("credit_account");
    if (["reserved", "pending", "settled"].includes(row.credit_state))
      return true;
    const reserved = costToCredits(snapshot.usd);
    const enough = (await available(client, input.userId)) >= units(reserved);
    await client.query(
      `UPDATE api_requests SET credit_state=$2,credit_reserved=$3,credit_usd_per_credit=$4,credit_reservation_snapshot=$5,
      credit_group=COALESCE('turn:' || turn_id::text, 'api:' || id::text)
      WHERE id=$1`,
      [
        input.id,
        enough ? "reserved" : "blocked",
        enough ? reserved : "0",
        creditTerms.usdPerCredit,
        { ...snapshot, creditTermsVersion: creditTerms.version },
      ],
    );
    return enough;
  });
  if (!enough) throw new CreditError("insufficient_credits");
}
export async function getCreditSummary(db: Database, userId: string) {
  return account(db, userId, async (client) => {
    await settleUser(client, userId);
    const { rows: entries } = await client.query(
      'SELECT id,amount,description,created_at AS "createdAt" FROM credit_ledger WHERE user_id=$1 ORDER BY created_at DESC',
      [userId],
    );
    const { rows: holds } = await client.query(
      "SELECT id,operation,credit_reserved,started_at FROM api_requests WHERE user_id=$1 AND credit_state IN ('reserved','pending') AND credit_reserved>0 ORDER BY started_at DESC",
      [userId],
    );
    const reserved = holds.reduce<bigint>(
      (sum, r) => sum + units(r.credit_reserved),
      0n,
    );
    const total = entries.reduce<bigint>((sum, r) => sum + units(r.amount), 0n);
    return {
      balance: Number(amount(total - reserved)),
      reserved: Number(amount(reserved)),
      total: Number(amount(total)),
      entries: [
        ...entries.map((r) => ({
          id: String(r.id),
          amount: Number(r.amount),
          description: String(r.description),
          createdAt: r.createdAt,
        })),
        ...holds.map((r) => ({
          id: `pending:${r.id}`,
          amount: -Number(r.credit_reserved),
          description: creditDescription(r.operation) + " (pending)",
          createdAt: r.started_at,
        })),
      ].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    };
  });
}
/**
 * Operator-only: adds credits to an account by email, e.g. to top up a local or
 * test account (npm run credits:add). Returns the new balance.
 */
export async function addCredits(
  db: Database,
  email: string,
  credits: string,
  description = "Credits added by an operator",
) {
  if (units(credits) <= 0n)
    throw new Error("Add a positive number of credits.");
  const {
    rows: [user],
  } = await db.query("SELECT id FROM users WHERE lower(email)=lower($1)", [
    email.trim(),
  ]);
  if (!user) throw new Error(`No account with the email ${email}.`);
  await account(db, user.id, (client) =>
    client.query(
      `INSERT INTO credit_ledger(user_id,amount,description,reference)
       VALUES ($1,$2,$3,'operator:' || gen_random_uuid())`,
      [user.id, credits, description],
    ),
  );
  return { userId: String(user.id), ...(await getCreditSummary(db, user.id)) };
}
/** Operator-only reconciliation. Historical uncharged rows are never backcharged. */
export async function reconcileApiCredits(
  db: Database,
  input: { id: string; cost: string; currency: string; source: string },
) {
  const {
    rows: [owner],
  } = await db.query("SELECT user_id FROM api_requests WHERE id=$1", [
    input.id,
  ]);
  if (!owner) throw new Error("API request not found.");
  const apply = async (client: Queryable) => {
    const {
      rows: [row],
    } = await client.query(
      `UPDATE api_requests SET reported_cost=$2,reported_currency=$3,reported_cost_source=$4 WHERE id=$1 RETURNING *`,
      [input.id, input.cost, input.currency, input.source],
    );
    await settle(client, row);
  };
  if (owner.user_id) await account(db, owner.user_id, apply);
  else await transaction(db, apply);
}

export async function assertHasCredits(db: Database, userId: string) {
  await account(db, userId, async (client) => {
    await settleUser(client, userId);
    if ((await available(client, userId)) <= 0n)
      throw new CreditError("insufficient_credits");
  });
}
