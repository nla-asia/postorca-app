import jwt from "jsonwebtoken";
import type { RequestHandler } from "express";
export function issueToken(userId: string, secret: string) {
  return jwt.sign({}, secret, {
    subject: userId,
    expiresIn: "12h",
    algorithm: "HS256",
    issuer: "postorca",
    audience: "postorca-desktop",
  });
}
/**
 * Device-bound token for a desktop install: the device ID is part of the signed
 * payload, so the server never trusts a client-supplied device identity. Used for the
 * desktop WebSocket and desktop tool results, never for the user API. The desktop
 * mints a new one with its session token when this nears expiry.
 */
export function issueDeviceToken(
  userId: string,
  deviceId: string,
  secret: string,
) {
  return jwt.sign({ device_id: deviceId }, secret, {
    subject: userId,
    expiresIn: "1h",
    algorithm: "HS256",
    issuer: "postorca",
    audience: "postorca-device",
  });
}
export function verifyDeviceToken(token: string, secret: string) {
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer: "postorca",
    audience: "postorca-device",
  });
  if (
    typeof payload === "string" ||
    !/^[0-9a-f-]{36}$/i.test(payload.sub ?? "") ||
    !/^[0-9a-f-]{36}$/i.test(payload.device_id ?? "")
  )
    throw new Error("Invalid device token");
  return { userId: payload.sub!, deviceId: payload.device_id as string };
}
export const authenticateDevice =
  (secret: string): RequestHandler =>
  (req, res, next) => {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    try {
      if (!match) throw new Error("Missing token");
      Object.assign(res.locals, verifyDeviceToken(match[1], secret));
      next();
    } catch {
      res.status(401).json({ error: "A device-bound token is required." });
    }
  };
export const authenticate =
  (secret: string): RequestHandler =>
  (req, res, next) => {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    if (!match) {
      res.status(401).json({ error: "Please log in." });
      return;
    }
    try {
      const payload = jwt.verify(match[1], secret, {
        algorithms: ["HS256"],
        issuer: "postorca",
        audience: "postorca-desktop",
      });
      if (
        typeof payload === "string" ||
        !payload.sub ||
        !/^[0-9a-f-]{36}$/i.test(payload.sub)
      )
        throw new Error("Invalid subject");
      res.locals.userId = payload.sub;
      next();
    } catch {
      res
        .status(401)
        .json({ error: "Your session has expired. Please log in again." });
    }
  };
