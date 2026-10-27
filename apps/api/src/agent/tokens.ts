/**
 * Request sizes. The context window is Orca's working budget: past it, older history
 * is compacted (context.ts), so it is also what usage is measured against in traces.
 */
export const CONTEXT_WINDOW_TOKENS = 100_000;
const CHARS_PER_TOKEN = 4;

/**
 * Rough token count (about 4 characters per token). Encrypted reasoning and inline
 * image data are replayed opaquely and not counted; images are counted separately.
 */
export function estimateTokens(value: unknown) {
  const json = JSON.stringify(value, (key, item) =>
    key === "encrypted_content" || key === "image_url" ? undefined : item,
  );
  return Math.ceil((json?.length ?? 0) / CHARS_PER_TOKEN);
}

/** Size of one model request against the window, for turn traces and logs. */
export function contextWindowStats(
  request: { instructions: string; input: unknown[]; tools: unknown[] },
  inputTokens?: number,
) {
  const breakdown = {
    instructions: estimateTokens(request.instructions),
    messages: estimateTokens(request.input),
    tools: estimateTokens(request.tools),
  };
  const estimated =
    breakdown.instructions + breakdown.messages + breakdown.tools;
  const images = request.input.reduce<number>(
    (count, item) =>
      count +
      ((item as { content?: unknown }).content instanceof Array
        ? (item as { content: { type?: string }[] }).content.filter(
            (part) => part.type === "input_image",
          ).length
        : 0),
    0,
  );
  return {
    /** Provider-reported; null when the request failed. */
    input_tokens: inputTokens ?? null,
    estimated_tokens: estimated,
    estimated_breakdown: breakdown,
    images,
    window_tokens: CONTEXT_WINDOW_TOKENS,
    used_percent:
      Math.round(((inputTokens ?? estimated) / CONTEXT_WINDOW_TOKENS) * 1000) /
      10,
  };
}
