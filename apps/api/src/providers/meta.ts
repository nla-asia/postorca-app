import type { Config } from "../config.js";
import { OpenAIProvider } from "./openai.js";

export const META_BASE_URL = "https://api.meta.ai/v1";

/** Meta Model API (Muse models) speaks the OpenAI Responses protocol, including
 * encrypted reasoning replay, tool calls, image input and prompt cache keys. */
export class MetaProvider extends OpenAIProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, META_BASE_URL);
  }
}

/** The provider Orca runs on, from its configuration. */
export function orcaProvider(orca: NonNullable<Config["orca"]>) {
  return orca.provider === "meta"
    ? new MetaProvider(orca.apiKey, orca.model)
    : new OpenAIProvider(orca.apiKey, orca.model);
}
