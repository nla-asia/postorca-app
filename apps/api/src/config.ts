import { z } from "zod";
import { PROVIDER_PRICING } from "./providers/pricing.js";

const origin = z.url({ protocol: /^https?$/ }).refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, "Use an HTTP(S) origin without paths, credentials, or a trailing slash.");
/** Each model use is chosen explicitly with <PREFIX>_PROVIDER and <PREFIX>_MODEL;
 * provider keys are only credentials and never choose a provider. */
const uses = {
  orca: {
    prefix: "ORCA",
    operation: "responses",
    keys: { openai: "OPENAI_API_KEY", meta: "META_MODEL_API_KEY" },
  },
  images: {
    prefix: "IMAGE",
    operation: "image.generate",
    // The OpenAI image key never falls back to the chat key.
    keys: { openai: "OPENAI_IMAGE_API_KEY", meta: "META_MODEL_API_KEY" },
  },
} as const;
type Use = keyof typeof uses;

/** Only models with checked-in prices can be chosen, so every request is priced. */
export function pricedModels(provider: string, operation: string) {
  return [
    ...new Set(
      PROVIDER_PRICING.filter(
        (rate) =>
          rate.enabled &&
          rate.provider === provider &&
          rate.operation === operation,
      ).map((rate) => rate.model),
    ),
  ];
}
const selection = (use: Use) => {
  const { prefix, operation, keys } = uses[use];
  return z
    .object({
      provider: z.enum(["openai", "meta"], {
        error: `Set ${prefix}_PROVIDER to openai or meta.`,
      }),
      model: z.string(),
      apiKey: z.string(),
    })
    .superRefine(({ provider, model, apiKey }, context) => {
      const models = pricedModels(provider, operation);
      if (!models.includes(model))
        context.addIssue({
          code: "custom",
          path: ["model"],
          message: `Set ${prefix}_MODEL to ${models.join(" or ")} for ${provider}.`,
        });
      if (!apiKey)
        context.addIssue({
          code: "custom",
          path: ["apiKey"],
          message: `Set ${keys[provider]} for ${prefix}_PROVIDER=${provider}.`,
        });
    })
    .nullable();
};
function selectionInput(env: NodeJS.ProcessEnv, use: Use) {
  const { prefix, keys } = uses[use];
  const provider = env[`${prefix}_PROVIDER`],
    model = env[`${prefix}_MODEL`];
  if (!provider && !model) return null;
  const key = keys[provider as keyof typeof keys];
  return {
    provider: provider ?? "",
    model: model ?? "",
    apiKey: key ? (env[key] ?? "") : "",
  };
}
function parsed<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid API configuration: ${messages.join("; ")}`);
  }
  return result.data;
}
const schema = z.object({
  databaseUrl: z.string().min(1, "DATABASE_URL is required."),
  jwtSecret: z
    .string()
    .min(32, "JWT_SECRET must contain at least 32 characters."),
  port: z.coerce.number().int().min(1).max(65535),
  origins: z.array(origin).min(1),
  /** Orca runs turns only when a model is chosen. */
  orca: selection("orca"),
  /** Image tools work only when an image model is chosen. */
  images: selection("images"),
});

/** Orca's chosen provider, model and key, or null when none is chosen. */
export function orcaFromEnv(env: NodeJS.ProcessEnv) {
  return parsed(
    z.object({ orca: selection("orca") }),
    { orca: selectionInput(env, "orca") },
  ).orca;
}
/** The chosen image provider, model and key, or null when none is chosen. */
export function imagesFromEnv(env: NodeJS.ProcessEnv) {
  return parsed(
    z.object({ images: selection("images") }),
    { images: selectionInput(env, "images") },
  ).images;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return parsed(schema, {
    databaseUrl: env.DATABASE_URL ?? "",
    jwtSecret: env.JWT_SECRET ?? "",
    port: env.PORT ?? "3001",
    origins: (
      env.CLIENT_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173"
    )
      .split(",")
      .map((value) => value.trim()),
    orca: selectionInput(env, "orca"),
    images: selectionInput(env, "images"),
  });
}

export type Config = ReturnType<typeof configFromEnv>;
