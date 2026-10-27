import { test } from "node:test";
import assert from "node:assert/strict";
import { systemPrompt } from "../src/agent/prompts.js";
import { coreSkills } from "../src/skills/index.js";
import { loadSkill, readSkillFile } from "../src/skills/load.js";
import { DEFAULT_ROUTINES } from "../src/seeds/default-routines.js";
import { executeTool, toolsForTask } from "../src/tools/index.js";
import type { Database } from "../src/db.js";

const demo = new URL("./fixtures/skills/demo-skill/", import.meta.url);

test("a skill is a folder whose SKILL.md frontmatter gives its name and description", () => {
  assert.deepEqual(loadSkill(demo), {
    name: "demo-skill",
    description: "A test skill: with a colon in its description.",
    dir: "../tests/fixtures/skills/demo-skill",
  });
  // Every core skill loads (loading throws on a missing or malformed SKILL.md).
  assert.deepEqual(
    coreSkills.map((skill) => skill.name),
    [
      "find-content-ideas",
      "create-content",
      "weekly-strategy-research",
      "conversations-to-join",
    ],
  );
  for (const skill of coreSkills) assert.ok(skill.description.length > 20);
});

test("read_skill reads SKILL.md without frontmatter, lists the folder's other files, and reads them", async () => {
  const skill = loadSkill(demo);
  assert.deepEqual(await readSkillFile(skill), {
    name: "demo-skill",
    content: "# Demo skill\n\nRead references/examples.md for examples.\n",
    files: ["references/examples.md"],
  });
  assert.deepEqual(await readSkillFile(skill, "references/examples.md"), {
    name: "demo-skill",
    file: "references/examples.md",
    content: "# Examples\n",
  });
  await assert.rejects(
    readSkillFile(skill, "references/missing.md"),
    /has no references\/missing\.md\. Its files: SKILL\.md, references\/examples\.md/,
  );
  // Only text files inside the skill's own folder.
  for (const file of ["../../../../.env", "/etc/passwd", "../demo-skill.md"])
    await assert.rejects(
      readSkillFile(skill, file),
      /inside the demo-skill skill/,
    );
});

test("every task can read core skills, and Orca's instructions list them", async () => {
  for (const kind of ["chat", "onboarding", "work"] as const) {
    const readSkill = toolsForTask(kind).find(
      (tool) => tool.name === "read_skill",
    );
    assert.deepEqual(
      (readSkill?.parameters as any).properties.name.enum,
      coreSkills.map((skill) => skill.name),
    );
  }
  const prompt = systemPrompt({
    task: { kind: "work", platform: "X" },
    profile: { onboarding_status: "completed" },
    memory: "",
    lastStep: false,
  });
  assert.match(
    prompt,
    /Skills: when a task names a skill, or its work matches one, read it with read_skill first and follow it\.\n- find-content-ideas: Find up to five content ideas/,
  );
  // Every skill a default routine names exists.
  for (const routine of DEFAULT_ROUTINES) {
    const named = /Read the ([\w-]+) skill/.exec(routine.instructions)?.[1];
    assert.ok(coreSkills.some((skill) => skill.name === named), named);
  }
  // The tool reads from disk only; it needs no database.
  const context = { userId: "u", taskId: "t", turnId: "r" };
  const db = {} as Database;
  const read = (await executeTool(db, context, "read_skill", {
    name: "find-content-ideas",
  })) as { name: string; content: string; files: string[] };
  assert.equal(read.name, "find-content-ideas");
  assert.match(read.content, /^# Find content ideas\n/);
  assert.deepEqual(read.files, ["references/review.md"]);
  const review = (await executeTool(db, context, "read_skill", {
    name: "find-content-ideas",
    file: "references/review.md",
  })) as { content: string };
  assert.ok(review.content.length > 0);
  await assert.rejects(
    executeTool(db, context, "read_skill", { name: "publish-post" }),
    /Skill publish-post is not available/,
  );
});
