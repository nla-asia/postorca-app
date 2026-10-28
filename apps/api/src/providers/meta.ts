import { OpenAIProvider } from "./openai.js";

export const META_BASE_URL = "https://api.meta.ai/v1";

/** Meta Model API (Muse models) speaks the OpenAI Responses protocol, including
 * encrypted reasoning replay, tool calls, image input and prompt cache keys. */
export class MetaProvider extends OpenAIProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, META_BASE_URL);
  }
}
