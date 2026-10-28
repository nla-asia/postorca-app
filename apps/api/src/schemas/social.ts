import { z } from "zod";
import { platforms } from "./platforms.js";

/** Longest reply the app accepts; each platform's own limit is checked in the app. */
export const MAX_REPLY = 3000;

/**
 * A draft reply to someone else's post, stored as the content of a `reply`
 * artifact. `intent` says why: joining a conversation, or connecting with the
 * author (the app then offers Follow). Platform and kind match social_posts.
 */
export const replySchema = z
  .object({
    platform: z.enum(platforms),
    kind: z.enum(["reply", "quote"]).default("reply"),
    intent: z.enum(["conversation", "connect"]),
    target: z
      .object({
        url: z.url({ protocol: /^https?$/ }),
        author: z.string().trim().min(1).max(120),
        handle: z.string().trim().max(60).optional(),
        text: z.string().trim().max(1000).optional(),
        posted_at: z.string().trim().max(60).optional(),
        stats: z
          .record(z.string().max(30), z.union([z.number(), z.string().max(30)]))
          .optional(),
      })
      .strict(),
    text: z.string().trim().min(1).max(MAX_REPLY),
    why: z.string().trim().max(240).optional(),
  })
  .strict();
export type Reply = z.infer<typeof replySchema>;
