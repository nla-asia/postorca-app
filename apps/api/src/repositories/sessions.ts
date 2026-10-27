import { createHash, randomBytes } from "node:crypto";
import { transaction, type Database, type Queryable } from "../db.js";
/** A session stays signed in while its app refreshes at least this often. */
const IDLE_DAYS = 30;
/**
 * A spent token presented again this soon is a client retrying a refresh whose
 * response it never received, not a copy; it gets a fresh token instead of
 * revoking the session.
 */
const RETRY_GRACE_SECONDS = 60;
const hash = (token: string) => createHash("sha256").update(token).digest();
async function issue(client: Queryable, sessionId: string) {
  const token = randomBytes(32).toString("base64url");
  await client.query(
    `INSERT INTO refresh_tokens(token_hash,session_id,expires_at)
     VALUES ($1,$2,now() + make_interval(days => $3))`,
    [hash(token), sessionId, IDLE_DAYS],
  );
  return token;
}
/** Starts a session at login; returns its first refresh token. */
export async function startSession(db: Database, userId: string) {
  return transaction(db, async (client) => {
    const {
      rows: [session],
    } = await client.query(
      "INSERT INTO auth_sessions(user_id) VALUES ($1) RETURNING id",
      [userId],
    );
    return issue(client, session.id);
  });
}
/**
 * Spends a refresh token and issues the next one. Returns null when the token is
 * unknown, expired, revoked, or reused (which also revokes its session).
 */
export async function rotateSession(db: Database, token: string) {
  return transaction(db, async (client) => {
    const {
      rows: [row],
    } = await client.query(
      `SELECT r.session_id, s.user_id, s.revoked_at IS NOT NULL AS revoked,
              r.expires_at <= now() AS expired, r.used_at IS NOT NULL AS used,
              r.used_at > now() - make_interval(secs => $2) AS retry
         FROM refresh_tokens r JOIN auth_sessions s ON s.id = r.session_id
        WHERE r.token_hash = $1
        FOR UPDATE OF s`,
      [hash(token), RETRY_GRACE_SECONDS],
    );
    if (!row || row.revoked || row.expired) return null;
    if (row.used && !row.retry) {
      await client.query(
        "UPDATE auth_sessions SET revoked_at=now() WHERE id=$1",
        [row.session_id],
      );
      await client.query("DELETE FROM refresh_tokens WHERE session_id=$1", [
        row.session_id,
      ]);
      return null;
    }
    // A session has one live token: this one, or after a retry the one the
    // client never received, is spent. Spent tokens are kept to detect reuse.
    await client.query(
      "UPDATE refresh_tokens SET used_at=now() WHERE session_id=$1 AND used_at IS NULL",
      [row.session_id],
    );
    await client.query(
      "DELETE FROM refresh_tokens WHERE session_id=$1 AND expires_at <= now()",
      [row.session_id],
    );
    return {
      userId: row.user_id as string,
      refreshToken: await issue(client, row.session_id),
    };
  });
}
/** Signs one session out (logout). Unknown tokens are ignored. */
export async function endSession(db: Database, token: string) {
  await db.query(
    `WITH ended AS (
       UPDATE auth_sessions SET revoked_at=now()
        WHERE id=(SELECT session_id FROM refresh_tokens WHERE token_hash=$1)
       RETURNING id)
     DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM ended)`,
    [hash(token)],
  );
}
