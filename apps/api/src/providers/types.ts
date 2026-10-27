import type { TurnTrace } from "../agent/trace.js";

import type { StoredMessage } from "../schemas/tasks.js";
export type { StoredMessage };

/** The request did not fit the model's context window. */
export class ContextTooLongError extends Error {
  constructor() {
    super("The conversation is too long for the model's context window.");
  }
}
export type ToolCall = { callId: string; name: string; arguments: string };
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
export interface Provider {
  respond(input: {
    instructions: string;
    messages: StoredMessage[];
    tools: ToolDefinition[];
    /** Requests sharing a key are routed to the same prompt cache (one per task). */
    cacheKey?: string;
    signal: AbortSignal;
    trace?: TurnTrace;
  }): Promise<{ text: string; calls: ToolCall[]; replay?: unknown[] }>;
}
