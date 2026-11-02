import { z } from "zod";
import { PROVIDER_PRICING } from "./providers/pricing.js";
import {
  settings,
  type ModelChoice,
  type TranscriptionChoice,
} from "./settings.js";

const origin = z.url({ protocol: /^https?$/ }).refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, "Use an HTTP(S) origin without paths, credentials, or a trailing slash.");
/** The credential for each model use and provider. The OpenAI image key never falls
 * back to the chat key. */
const keys = {
  orca: { openai: "OPENAI_API_KEY", meta: "META_MODEL_API_KEY" },
  images: { openai: "OPENAI_IMAGE_API_KEY", meta: "META_MODEL_API_KEY" },
  transcription: {
    meta: "META_MODEL_API_KEY",
    elevenlabs: "ELEVENLABS_API_KEY",
  },
} as const;
const operations = {
  orca: "responses",
  images: "image.generate",
  transcription: "transcription",
} as const;
type Choices = {
  orca: ModelChoice;
  images: ModelChoice;
  transcription: TranscriptionChoice;
};
type Use = keyof typeof keys;

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
/**
 * The model chosen in settings with its key, or null when the key is not set (that
 * capability is then off). An unpriced model fails before the server starts.
 */
function chosenModel<U extends Use>(
  use: U,
  env: NodeJS.ProcessEnv,
  choice: Choices[U] = settings[use],
) {
  const models = pricedModels(choice.provider, operations[use]);
  if (!models.includes(choice.model))
    throw new Error(
      `Invalid API configuration: settings.${use}.model must be ${models.join(" or ")} for ${choice.provider}.`,
    );
  const apiKey =
    env[keys[use][choice.provider as keyof (typeof keys)[U]] as string]?.trim();
  return apiKey ? { ...choice, apiKey } : null;
}
/** The environment variable holding the key a model use needs. */
export const keyFor = <U extends Use>(
  use: U,
  choice: Choices[U] = settings[use],
) => keys[use][choice.provider as keyof (typeof keys)[U]] as string;

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
});

/** Orca's model with its key, or null while the key is not set. */
export function orcaFromEnv(env: NodeJS.ProcessEnv, choice?: ModelChoice) {
  return chosenModel("orca", env, choice);
}
/** The image model with its key, or null while the key is not set. */
export function imagesFromEnv(env: NodeJS.ProcessEnv, choice?: ModelChoice) {
  return chosenModel("images", env, choice);
}

/** The transcription model with its own selected provider's key. */
export function transcriptionFromEnv(
  env: NodeJS.ProcessEnv,
  choice?: TranscriptionChoice,
) {
  return chosenModel("transcription", env, choice);
}

export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  models: Partial<Choices> = {},
) {
  const config = parsed(schema, {
    databaseUrl: env.DATABASE_URL ?? "",
    jwtSecret: env.JWT_SECRET ?? "",
    port: env.PORT ?? "3001",
    origins: (
      env.CLIENT_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173"
    )
      .split(",")
      .map((value) => value.trim()),
  });
  return {
    ...config,
    /** Orca runs turns only while its model's key is set. */
    orca: orcaFromEnv(env, models.orca),
    /** Image tools work only while the image model's key is set. */
    images: imagesFromEnv(env, models.images),
    transcription: transcriptionFromEnv(env, models.transcription),
  };
}

export type Config = ReturnType<typeof configFromEnv>;
