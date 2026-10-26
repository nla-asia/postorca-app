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
  port: z.coerce.number().int().min(1).max(65535),
  origins: z.array(origin).min(1),
});

export function configFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse({
    databaseUrl: env.DATABASE_URL ?? "",
    port: env.PORT ?? "3001",
    origins: (
      env.CLIENT_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173"
    )
      .split(",")
      .map((value) => value.trim()),
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
