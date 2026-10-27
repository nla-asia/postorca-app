import { z } from "zod";
import { HttpError } from "../handlers/errors.js";
import { coreSkills } from "../skills/index.js";
import { readSkillFile } from "../skills/load.js";
import { object, type Tool } from "./shared.js";

/** Reads a core skill: how to do a kind of work. Offered in every task. */
export const skillTools: Tool[] = [
  {
    definition: {
      name: "read_skill",
      description:
        "Read a skill: instructions for doing a kind of work. Returns its SKILL.md and lists any other files in the skill, which you can read with file.",
      parameters: object(
        {
          name: {
            type: "string",
            enum: coreSkills.map((skill) => skill.name),
          },
          file: {
            type: "string",
            description:
              "A file listed by the skill, e.g. references/examples.md. Omit for SKILL.md.",
          },
        },
        ["name"],
      ),
    },
    run: async (_context, args) => {
      const { name, file } = z
        .object({ name: z.string(), file: z.string().min(1).optional() })
        .strict()
        .parse(args);
      const skill = coreSkills.find((candidate) => candidate.name === name);
      if (!skill) throw new HttpError(400, `Skill ${name} is not available.`);
      return readSkillFile(skill, file);
    },
  },
];
