import { ensureWelcomeCredits } from "../billing/credits.js";
import { randomBytes, scrypt as derive, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { transaction, type Database, type Queryable } from "../db.js";
import { seedDefaultRoutines } from "./routines.js";
const scrypt = promisify(derive);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored?: string) {
  const [salt, encoded] = stored?.split(":") ?? [
    "missing-user-salt",
    "00".repeat(64),
  ];
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(encoded, "hex");
  return (
    !!stored &&
    expected.length === hash.length &&
    timingSafeEqual(expected, hash)
  );
}
export async function createUser(
  db: Database,
  name: string,
  email: string,
  password: string,
) {
  const hash = await hashPassword(password);
  return transaction(db, async (client) => {
    const {
      rows: [user],
    } = await client.query(
      "INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email",
      [name, email, hash],
    );
    await client.query("INSERT INTO brand_profiles(user_id) VALUES ($1)", [
      user.id,
    ]);
    await ensureWelcomeCredits(client, user.id);
    return user;
  });
}
export async function findUserByEmail(db: Queryable, email: string) {
  const {
    rows: [user],
  } = await db.query(
    "SELECT id,name,email,password_hash FROM users WHERE email=$1",
    [email],
  );
  return user;
}
export async function findUser(db: Queryable, userId: string) {
  const {
    rows: [user],
  } = await db.query("SELECT id,name,email FROM users WHERE id=$1", [userId]);
  return user;
}
/**
 * Records the founder's IANA time zone as reported by their client. Unknown zones
 * are ignored. Learning it can seed default routines held back for lack of one.
 */
export async function saveTimezone(
  db: Database,
  userId: string,
  timezone: string | undefined,
) {
  if (!timezone) return;
  await transaction(db, async (client) => {
    const updated = await client.query(
      `UPDATE users SET timezone = $2 WHERE id = $1 AND timezone IS DISTINCT FROM $2
       AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $2)`,
      [userId, timezone],
    );
    if (updated.rowCount) await seedDefaultRoutines(client, userId);
  });
}
