import { z } from "zod";
import { requireChatTask, type Tool } from "./shared.js";

export const questionRequestSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(1000),
            options: z.array(z.string().trim().min(1).max(300)).min(2).max(8),
            multiple: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1),
  })
  .strict();

/** Asks the founder one multiple-choice question; the turn ends and waits for their reply. */
export const questionTool: Tool = {
  definition: {
    name: "request_user_input",
    description:
      "Ask exactly one short, focused multiple-choice question using the interactive widget, with 2-8 brief, neutral choices; the founder can always type their own answer. Only use it when suggested choices help. For open questions (a URL, a name, what they are building), ask in plain text instead and end your reply. Use one request_user_input call per turn with exactly one questions item. Do not pack multiple questions or multiple accounts/sites into its question text. Use multiple=true when several choices answer the same question, such as primary topics. This ends your turn and waits for their next message. Save established details with update_brand_profile and individual links with save_brand_link before asking the next question.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question", "options"],
            properties: {
              question: { type: "string" },
              options: {
                type: "array",
                minItems: 2,
                maxItems: 8,
                items: { type: "string" },
              },
              multiple: { type: "boolean" },
            },
          },
        },
      },
    },
  },
  chatOnly: true,
  run: async (context, args) => {
    await requireChatTask(
      context,
      "Interactive questions are available from Agent chat only.",
    );
    return {
      status: "awaiting_user_input",
      ...questionRequestSchema.parse(args),
    };
  },
};
