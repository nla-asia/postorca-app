import { test } from "node:test";
import assert from "node:assert/strict";
import { coreSkills } from "../src/skills/index.js";
import { loadSkill, readSkillFile } from "../src/skills/load.js";
import {
  DEFAULT_ROUTINES,
  WORK_IDEAS_ROUTINE,
} from "../src/seeds/default-routines.js";

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
      "work-content-ideas",
      "publish-post",
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

test("every skill a default routine names is a core skill", () => {
  for (const routine of [...DEFAULT_ROUTINES, WORK_IDEAS_ROUTINE]) {
    const named = /Read the ([\w-]+) skill/.exec(routine.instructions)?.[1];
    assert.ok(coreSkills.some((skill) => skill.name === named), named);
  }
});
