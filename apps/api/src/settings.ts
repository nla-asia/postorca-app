/**
 * Checked-in application settings: values that are the same in every environment.
 * Secrets and anything that differs between environments (URLs, client IDs, price
 * IDs) stay in .env, and a key never chooses a provider or model.
 */
export const settings = {
  /** The model Orca runs on. */
  orca: { provider: "meta", model: "muse-spark-1.3" } satisfies ModelChoice,
  /** The model the image tools generate and edit with. */
  images: { provider: "meta", model: "muse-image-1.0" } satisfies ModelChoice,
  /** Credits granted once to every new account. */
  welcomeCredits: 250,
  /** Model responses that still see a tool image before only its reference is kept
   * (each frame costs about 1–3k tokens). */
  agentImageSteps: 1,
} as const;

export type Provider = "openai" | "meta";
export type ModelChoice = { provider: Provider; model: string };
