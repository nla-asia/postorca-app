import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { transaction, type Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import { connectors, googleConfig, type Connector } from "./catalog.js";
import { z } from "zod";

type Tokens = { access_token: string; refresh_token: string };

const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

function config() {
  const value = googleConfig();
  if (!value)
    throw new HttpError(
      503,
      "Google connections are not configured on the server yet.",
    );
  return value;
}

function encrypt(tokens: Tokens) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config().key, iv);
  return Buffer.concat([
    iv,
    cipher.update(JSON.stringify(tokens)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}

function decrypt(value: Buffer): Tokens {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    config().key,
    value.subarray(0, 12),
  );
  decipher.setAuthTag(value.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(value.subarray(12, -16)),
      decipher.final(),
    ]).toString(),
  );
}

async function exchange(parameters: Record<string, string>) {
  const settings = config();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      ...parameters,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const parsed = z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().optional(),
      scope: z.string().optional(),
      expires_in: z.number().positive(),
    })
    .safeParse(await response.json());
  if (!response.ok || !parsed.success)
    throw new HttpError(
      400,
      "Google authorization failed. Reconnect the app in Connect Apps.",
    );
  return parsed.data;
}

function checkScopes(connector: Connector, scopes: string[]) {
  if (!connectors[connector].scopes.every((scope) => scopes.includes(scope)))
    throw new HttpError(
      400,
      "Google did not grant the required permissions. Reconnect the app and allow its requested permissions.",
    );
}

export async function listConnections(db: Database, userId: string) {
  const { rows } = await db.query(
    "SELECT connector,email FROM user_connections WHERE user_id=$1",
    [userId],
  );
  return Object.entries(connectors).map(([id, entry]) => ({
    id,
    name: entry.name,
    description: entry.description,
    connected: rows.some((row) => row.connector === id),
    email: rows.find((row) => row.connector === id)?.email ?? null,
  }));
}

export async function beginConnection(
  db: Database,
  userId: string,
  connector: Connector,
) {
  const settings = config();
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  await transaction(db, async (client) => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    await client.query(
      "DELETE FROM connector_oauth_states WHERE expires_at<=now() OR (user_id=$1 AND connector=$2)",
      [userId, connector],
    );
    await client.query(
      "INSERT INTO connector_oauth_states VALUES ($1,$2,$3,$4,now()+interval '10 minutes')",
      [hash(state), userId, connector, verifier],
    );
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/userinfo.email",
      ...connectors[connector].scopes,
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: hash(verifier),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.href };
}

export async function finishConnection(
  db: Database,
  state: string,
  code?: string,
  denied = false,
) {
  // Consume before exchange, so callbacks cannot be replayed. Tokens never reach the renderer.
  const {
    rows: [pending],
  } = await db.query(
    "SELECT user_id FROM connector_oauth_states WHERE state_hash=$1 AND expires_at>now()",
    [hash(state)],
  );
  if (!pending)
    throw new HttpError(
      400,
      "This connection request expired or was already used. Start again in PostOrca.",
    );
  const outcome = await transaction(db, async (client) => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      pending.user_id,
    ]);
    const {
      rows: [request],
    } = await client.query(
      "DELETE FROM connector_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING *",
      [hash(state)],
    );
    if (!request)
      throw new HttpError(
        400,
        "This connection request expired or was already used.",
      );
    if (denied || !code) return false;
    try {
      const connector = request.connector as Connector;
      const token = await exchange({
        code,
        code_verifier: request.verifier,
        redirect_uri: config().redirectUri,
        grant_type: "authorization_code",
      });
      const scopes = (token.scope ?? "").split(/\s+/).filter(Boolean);
      checkScopes(connector, scopes);
      if (!token.refresh_token)
        throw new HttpError(
          400,
          "Google did not return offline access. Please reconnect and allow access.",
        );
      const response = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      const account = z
        .object({ email: z.email() })
        .safeParse(await response.json());
      if (!response.ok || !account.success)
        throw new HttpError(400, "Unable to identify the Google account.");
      await client.query(
        `INSERT INTO user_connections(user_id,connector,email,tokens,expires_at,scopes) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (user_id,connector) DO UPDATE SET email=$3,tokens=$4,expires_at=$5,scopes=$6`,
        [
          request.user_id,
          connector,
          account.data.email,
          encrypt({
            access_token: token.access_token,
            refresh_token: token.refresh_token,
          }),
          new Date(Date.now() + token.expires_in * 1000),
          scopes,
        ],
      );
      return true;
    } catch (error) {
      return { error };
    }
  });
  if (typeof outcome === "object") throw outcome.error;
  return outcome;
}

export async function disconnectConnection(
  db: Database,
  userId: string,
  connector: Connector,
) {
  // Local disconnection is per app. Revoking Google's combined grant could break
  // the other Google connector, so do not revoke that shared grant here.
  await transaction(db, async (client) => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    await client.query(
      "DELETE FROM connector_oauth_states WHERE user_id=$1 AND connector=$2",
      [userId, connector],
    );
    await client.query(
      "DELETE FROM user_connections WHERE user_id=$1 AND connector=$2",
      [userId, connector],
    );
  });
}

export async function connectionAccessToken(
  db: Database,
  userId: string,
  connector: Connector,
) {
  return transaction(db, async (client) => {
    const {
      rows: [connection],
    } = await client.query(
      "SELECT * FROM user_connections WHERE user_id=$1 AND connector=$2 FOR UPDATE",
      [userId, connector],
    );
    if (!connection)
      throw new HttpError(
        400,
        `Connect ${connectors[connector].name} in Connect Apps first.`,
      );
    checkScopes(connector, connection.scopes);
    const tokens = decrypt(connection.tokens);
    if (new Date(connection.expires_at).getTime() > Date.now() + 60_000)
      return tokens.access_token;
    const refreshed = await exchange({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    const scopes = refreshed.scope
      ? refreshed.scope.split(/\s+/)
      : connection.scopes;
    checkScopes(connector, scopes);
    await client.query(
      "UPDATE user_connections SET tokens=$3,expires_at=$4,scopes=$5 WHERE user_id=$1 AND connector=$2",
      [
        userId,
        connector,
        encrypt({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
        }),
        new Date(Date.now() + refreshed.expires_in * 1000),
        scopes,
      ],
    );
    return refreshed.access_token;
  });
}
