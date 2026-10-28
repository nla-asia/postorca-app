import { z } from "zod";

const origin = z.url({ protocol: /^https?$/ }).refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, "Use an HTTP(S) origin without paths, credentials, or a trailing slash.");
/** Each model provider's credential and model variables. */
const providerEnv = {
  openai: { apiKey: "OPENAI_API_KEY", model: "OPENAI_MODEL" },
  meta: { apiKey: "META_MODEL_API_KEY", model: "META_MODEL" },
} as const;
const providerConfig = <P extends keyof typeof providerEnv>(provider: P) => {
  const { apiKey, model } = providerEnv[provider];
  return z.object({
    provider: z.literal(provider),
    apiKey: z.string().min(1, `Set ${apiKey} together with ${model}.`),
    model: z.string().min(1, `Set ${model} together with ${apiKey}.`),
  });
};
const schema = z.object({
  databaseUrl: z.string().min(1, "DATABASE_URL is required."),
  jwtSecret: z
    .string()
    .min(32, "JWT_SECRET must contain at least 32 characters."),
  port: z.coerce.number().int().min(1).max(65535),
  origins: z.array(origin).min(1),
  /** Orca runs turns only when a model is configured. */
  orca: z
    .discriminatedUnion(
      "provider",
      [providerConfig("openai"), providerConfig("meta")],
      { error: "Set ORCA_PROVIDER to openai or meta." },
    )
    .nullable(),
});

/** ORCA_PROVIDER picks the provider; without it, Meta is used when its variables are
 * set, then OpenAI. */
function orcaFromEnv(env: NodeJS.ProcessEnv) {
  const configured = (Object.keys(providerEnv) as (keyof typeof providerEnv)[])
    .reverse()
    .find(
      (provider) =>
        env[providerEnv[provider].apiKey] || env[providerEnv[provider].model],
    );
  const provider = env.ORCA_PROVIDER || configured;
  if (!provider) return null;
  const names = providerEnv[provider as keyof typeof providerEnv];
  return {
    provider,
    apiKey: names ? (env[names.apiKey] ?? "") : "",
    model: names ? (env[names.model] ?? "") : "",
  };
}

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
    orca: orcaFromEnv(env),
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
