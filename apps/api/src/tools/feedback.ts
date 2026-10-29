import { z } from "zod";
import { contentFeedback } from "../repositories/feedback.js";
import { object, type Tool } from "./shared.js";

/** Read-only: what the founder asked to change in content work, for the voice review. */
export const feedbackTools: Tool[] = [
  {
    definition: {
      name: "list_content_feedback",
      description:
        "Read the messages the founder sent in content tasks (drafts of posts) in the last `hours` (default 24), grouped by task with its title and platform. The routine's own instructions are not included. Read-only.",
      parameters: object(
        { hours: { type: "integer", minimum: 1, maximum: 168 } },
        [],
      ),
    },
    run: async ({ db, userId }, args) => {
      const { hours } = z
        .object({ hours: z.number().int().min(1).max(168).default(24) })
        .strict()
        .parse(args);
      const tasks = await contentFeedback(
        db,
        userId,
        new Date(Date.now() - hours * 3_600_000),
      );
      return tasks.length
        ? { tasks }
        : {
            tasks,
            message: `The founder sent no messages in content tasks in the last ${hours} hours.`,
          };
    },
  },
];
