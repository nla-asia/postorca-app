import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Database } from "../db.js";
import {
  createUser,
  findUser,
  findUserByEmail,
  saveTimezone,
  verifyPassword,
} from "../repositories/users.js";
import { authenticate, issueToken } from "../middleware/auth.js";
import {
  endSession,
  rotateSession,
  startSession,
} from "../repositories/sessions.js";
import { HttpError } from "../handlers/errors.js";
const login = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(256),
});
const refresh = z.object({ refreshToken: z.string().min(1).max(200) });
export function authRoutes(db: Database, secret: string) {
  const router = Router();
  // A login is a short-lived access token plus a rotating refresh token.
  const signIn = async (userId: string) => ({
    token: issueToken(userId, secret),
    refreshToken: await startSession(db, userId),
  });
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many attempts. Please try again later." },
    }),
  );
  router.post("/register", async (req, res) => {
    const data = login
      .extend({
        name: z.string().trim().min(1).max(120),
        password: z.string().min(8).max(256),
      })
      .parse(req.body);
    const user = await createUser(db, data.name, data.email, data.password);
    await saveTimezone(db, user.id, req.get("X-Timezone"));
    res.status(201).json({ user, ...(await signIn(user.id)) });
  });
  router.post("/login", async (req, res) => {
    const data = login.parse(req.body);
    const user = await findUserByEmail(db, data.email);
    if (!(await verifyPassword(data.password, user?.password_hash)))
      throw new HttpError(401, "Email or password is incorrect.");
    await saveTimezone(db, user.id, req.get("X-Timezone"));
    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      ...(await signIn(user.id)),
    });
  });
  router.post("/refresh", async (req, res) => {
    const session = await rotateSession(db, refresh.parse(req.body).refreshToken);
    if (!session)
      throw new HttpError(401, "Your session has ended. Please log in again.");
    res.json({
      token: issueToken(session.userId, secret),
      refreshToken: session.refreshToken,
    });
  });
  router.post("/logout", async (req, res) => {
    await endSession(db, refresh.parse(req.body).refreshToken);
    res.status(204).end();
  });
  router.get("/me", authenticate(secret), async (req, res) => {
    const user = await findUser(db, res.locals.userId);
    if (!user) throw new HttpError(401, "Please log in.");
    // Clients report their time zone at sign-in and app start.
    await saveTimezone(db, user.id, req.get("X-Timezone"));
    res.json({ user });
  });
  return router;
}
