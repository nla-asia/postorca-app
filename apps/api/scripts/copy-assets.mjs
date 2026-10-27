import { cp } from "node:fs/promises";

// SQL migrations, prompt text, and core and plugin skill folders; only their text
// files are copied (TypeScript is compiled separately).
await Promise.all(
  ["migrations", "agent/prompts", "skills", "plugins"].map((directory) =>
    cp(
      new URL(`../src/${directory}/`, import.meta.url),
      new URL(`../dist/${directory}/`, import.meta.url),
      { recursive: true, filter: (source) => !source.endsWith(".ts") },
    ),
  ),
);
