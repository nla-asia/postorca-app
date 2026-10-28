import { readFileSync } from "node:fs";
import type { TaskKind } from "../repositories/tasks.js";
import { pluginPrompt, type PluginState } from "../plugins/service.js";

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
  voice: load("voice"),
  lastStep: load("last-step"),
};

export function systemPrompt(step: {
  task: { kind: TaskKind; platform: string | null };
  profile: { onboarding_status: string };
  plugins: PluginState;
  /** memoryIndex(): one line per memory file, read at the start of the turn. */
  memory: string;
  /** voice.md's content, read at the start of the turn; "" before it exists. */
  voice: string;
  lastStep: boolean;
}) {
  const { task, profile } = step;
  const sections = [
    `Brand profile: ${JSON.stringify(profile)}`,
    prompts.voice,
    step.voice
      ? `voice.md (from the start of this turn):\n${step.voice}`
      : "voice.md doesn't exist yet: until it does, follow the founder's recent posts.",
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
    pluginPrompt(step.plugins) +
    sections
      .filter(Boolean)
      .map((section) => `\n${section}`)
      .join("")
  );
}
