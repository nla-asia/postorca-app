/**
 * Checked-in application settings. Nothing here is secret: credentials and
 * per-machine values stay in .env, and a key never chooses a provider or model.
 */
export const settings = {
  /** The model Orca runs on. */
  orca: { provider: "meta", model: "muse-spark-1.3" },
  /** The model the image tools generate and edit with. */
  images: { provider: "meta", model: "muse-image-1.0" },
} as const satisfies Record<string, ModelChoice>;

export type Provider = "openai" | "meta";
export type ModelChoice = { provider: Provider; model: string };
