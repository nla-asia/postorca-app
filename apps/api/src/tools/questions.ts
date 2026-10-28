import { z } from "zod";
import { requireChatTask, type Tool } from "./shared.js";

/** A choice is a short answer, or a style name with a full sample post the
 * founder reads before picking it. Only the label is sent back as the answer. */
const optionSchema = z.union([
  z.string().trim().min(1).max(300),
  z
    .object({
      label: z.string().trim().min(1).max(120),
      preview: z.string().trim().min(1).max(1500),
    })
    .strict(),
]);

export const questionRequestSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(1000),
            options: z.array(optionSchema).min(2).max(8),
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
      "Ask exactly one short, focused multiple-choice question using the interactive widget, with 2-8 brief, neutral choices; the founder can always type their own answer. Only use it when suggested choices help. For open questions (a URL, a name, what they are building), ask in plain text instead and end your reply. Use one request_user_input call per turn with exactly one questions item. Do not pack multiple questions or multiple accounts/sites into its question text. Use multiple=true when several choices answer the same question, such as primary topics. Choices are plain strings. Only when the founder should compare full samples (the same post written in different styles), give a choice as {label, preview}: a short style name and the full sample post, different from the label; such choices show as cards and only the label comes back as the answer. This ends your turn and waits for their next message. Save established details with update_brand_profile and individual links with save_brand_link before asking the next question.",
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
                items: {
                  anyOf: [
                    { type: "string" },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["label", "preview"],
                      properties: {
                        label: { type: "string" },
                        preview: { type: "string" },
                      },
                    },
                  ],
                },
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
