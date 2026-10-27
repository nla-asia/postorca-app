import { z } from "zod";

const origin = z.url({ protocol: /^https?$/ }).refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, "Use an HTTP(S) origin without paths, credentials, or a trailing slash.");
const schema = z.object({
  databaseUrl: z.string().min(1, "DATABASE_URL is required."),
  jwtSecret: z
    .string()
    .min(32, "JWT_SECRET must contain at least 32 characters."),
  port: z.coerce.number().int().min(1).max(65535),
  origins: z.array(origin).min(1),
  /** Orca runs turns only when a model is configured. */
  openai: z
    .object({
      apiKey: z.string().min(1, "Set OPENAI_API_KEY together with OPENAI_MODEL."),
      model: z.string().min(1, "Set OPENAI_MODEL together with OPENAI_API_KEY."),
    })
    .nullable(),
});

export function configFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse({
    databaseUrl: env.DATABASE_URL ?? "",
    jwtSecret: env.JWT_SECRET ?? "",
    port: env.PORT ?? "3001",
    origins: (
      env.CLIENT_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173"
    )
      .split(",")
      .map((value) => value.trim()),
    openai:
      env.OPENAI_API_KEY || env.OPENAI_MODEL
        ? { apiKey: env.OPENAI_API_KEY ?? "", model: env.OPENAI_MODEL ?? "" }
        : null,
  });
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid API configuration: ${messages.join("; ")}`);
  }
  return result.data;
}

export type Config = ReturnType<typeof configFromEnv>;
