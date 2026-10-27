import { readFileSync } from "node:fs";
import type { TaskKind } from "../repositories/tasks.js";
import { coreSkills } from "../skills/index.js";

/**
 * Orca's system instructions. The prose lives in prompts/*.md so it can be read and
 * reviewed as text; this module only decides which sections apply to a step.
 * Placeholders are written {{name}}.
 */
const load = (name: string) =>
  readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8").trim();
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/{{(\w+)}}/g, (_, key: string) => values[key]);

const prompts = {
  system: load("system"),
  chat: load("chat"),
  work: load("work"),
  onboarding: load("onboarding"),
  lastStep: load("last-step"),
};

// Core skills are fixed for the life of the process, so their list is built once.
const skillList = `
Skills: when a task names a skill, or its work matches one, read it with read_skill first and follow it.
${coreSkills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}`;

export function systemPrompt(step: {
  task: { kind: TaskKind; platform: string | null };
  profile: { onboarding_status: string };
  /** memoryIndex(): one line per memory file, read at the start of the turn. */
  memory: string;
  lastStep: boolean;
}) {
  const { task, profile } = step;
  const sections = [
    `Brand profile: ${JSON.stringify(profile)}`,
    step.memory
      ? `Your memory files (read the ones that matter for this work with read_memory; this list is from the start of this turn):\n${step.memory}`
      : "Your memory is empty.",
    task.kind === "work"
      ? fill(prompts.work, {
          platform: task.platform ? ` for ${task.platform}` : "",
        })
      : prompts.chat,
    task.kind === "onboarding" ? prompts.onboarding : "",
    step.lastStep ? prompts.lastStep : "",
  ];
  return (
    prompts.system +
    skillList +
    sections
      .filter(Boolean)
      .map((section) => `\n${section}`)
      .join("")
  );
}
