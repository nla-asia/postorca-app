import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import { ContextTooLongError, type Provider } from "./types.js";
import { writeTurnTrace } from "../agent/trace.js";
import { contextWindowStats } from "../agent/tokens.js";
export class OpenAIProvider implements Provider {
  private client: OpenAI;
  constructor(
    apiKey: string,
    private model: string,
  ) {
    // Model calls have no side effects, so connection drops, 429s and 5xxs are
    // retried with the SDK's backoff instead of failing the whole turn. A step with a
    // few images can take over a minute, so the timeout leaves room for that.
    this.client = new OpenAI({ apiKey, timeout: 180_000, maxRetries: 3 });
  }
  async respond({
    instructions,
    messages,
    tools,
    cacheKey,
    signal,
    trace,
  }: Parameters<Provider["respond"]>[0]) {
    const input: ResponseInputItem[] = [];
    // Tool images go after all of the step's function outputs, so every function_call
    // stays directly answered by its output. Images are dropped from later requests,
    // so the step's last output carries an explicit cache breakpoint, in this request
    // and every later one (a breakpoint is part of the cached prompt): the next request
    // reuses everything up to it.
    let images: ResponseInputItem[] = [];
    let lastOutput: { output: unknown } | undefined;
    let stepHadImages = false;
    const endStep = () => {
      if (stepHadImages && lastOutput) {
        const [text] = lastOutput.output as object[];
        Object.assign(text, { prompt_cache_breakpoint: { mode: "explicit" } });
      }
      input.push(...images);
      images = [];
      lastOutput = undefined;
      stepHadImages = false;
    };
    for (const message of messages) {
      // Tool calls are replayed with the assistant message, so they don't end a step.
      if (message.kind === "user" || message.kind === "assistant") endStep();
      // The time goes with each message rather than in the instructions, so the
      // instructions stay the same across turns and the prompt cache keeps working.
      if (message.kind === "user")
        input.push({
          role: "user",
          // Generated context summaries have no founder send time.
          content: message.created_at
            ? `[Sent ${new Date(message.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC]\n${message.content.text}`
            : message.content.text,
        });
      if (message.kind === "assistant") {
        if (message.content.replay) input.push(...message.content.replay);
        else input.push({ role: "assistant", content: message.content.text });
      }
      // Function-call items are already retained with the assistant's replay payload.
      if (message.kind === "tool_result") {
        const output = {
          type: "function_call_output" as const,
          call_id: message.content.callId,
          // A content list rather than a string, so a cache breakpoint can be set on it.
          output: [
            {
              type: "input_text" as const,
              text: JSON.stringify(message.content.result),
            },
          ],
        };
        input.push(output);
        lastOutput = output;
        stepHadImages ||= !!message.content.hadImages;
      }
      if (message.kind === "tool_result" && message.content.images?.length)
        images.push({
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Image returned by tool call ${message.content.callId}. You see it in this step only: in this response, before or alongside any tool calls, write in text what you observe that matters for the task, so you can rely on that description later.`,
            },
            ...message.content.images.map(
              (image: { mime_type: string; base64: string }) => ({
                type: "input_image" as const,
                detail: "auto" as const,
                image_url: `data:${image.mime_type};base64,${image.base64}`,
              }),
            ),
          ],
        });
    }
    endStep();
    // Agent-initiated conversations have no user message yet. Responses requires
    // nonempty input; keep the kickoff as application instruction, not user text.
    if (!input.length)
      input.push({
        role: "developer",
        content: "Begin the conversation by following the instructions above.",
      });
    const request = {
      model: this.model,
      instructions,
      input,
      store: false as const,
      include: ["reasoning.encrypted_content" as const],
      ...(cacheKey && { prompt_cache_key: cacheKey }),
      tools: tools.map((tool) => ({
        type: "function" as const,
        ...tool,
        strict: false as const,
      })),
    };
    await writeTurnTrace(trace, "request", request);
    let response;
    try {
      response = await this.client.responses.create(request, { signal });
    } catch (error) {
      await writeTurnTrace(trace, "result", {
        status: "failed",
        // Avoid dumping SDK errors, which can contain request headers/body.
        error: error instanceof Error ? error.name : "UnknownError",
        ...(error instanceof OpenAI.APIError
          ? { http_status: error.status }
          : {}),
        context: contextWindowStats(request),
      });
      if (
        error instanceof OpenAI.APIError &&
        error.code === "context_length_exceeded"
      )
        throw new ContextTooLongError();
      throw error;
    }
    const context = contextWindowStats(request, response.usage?.input_tokens);
    await writeTurnTrace(trace, "result", {
      id: response.id,
      model: response.model,
      status: response.status,
      usage: response.usage ?? null,
      context,
    });
    if (trace)
      console.info(
        `Agent turn ${trace.turnId} step ${trace.step}: ${context.input_tokens ?? context.estimated_tokens} input tokens, ${context.used_percent}% of the ${context.window_tokens}-token window${context.images ? ` (${context.images} image${context.images > 1 ? "s" : ""})` : ""}.`,
      );
    if (response.status !== "completed")
      throw new Error("The model did not complete its response.");
    return {
      text: response.output_text,
      replay: toResponseInputItems(response.output),
      calls: response.output.flatMap((item) =>
        item.type === "function_call"
          ? [
              {
                callId: item.call_id,
                name: item.name,
                arguments: item.arguments,
              },
            ]
          : [],
      ),
    };
  }
}
