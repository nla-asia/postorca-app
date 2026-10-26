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
