import { loadSkill } from "./load.js";

/**
 * Core skills: how to do a kind of work, readable with read_skill in any task.
 * Routines name the skill to follow instead of carrying the process. Each is a
 * folder here with a SKILL.md.
 */
export const coreSkills = [
  "find-content-ideas",
  "create-content",
  "weekly-strategy-research",
  "conversations-to-join",
  "work-content-ideas",
].map((name) => loadSkill(new URL(`./${name}/`, import.meta.url)));
