import { cp } from "node:fs/promises";

// SQL migrations, prompt text and skill folders; skills keep only their text files
// (their TypeScript is compiled separately).
await Promise.all(
  ["migrations", "agent/prompts", "skills"].map((directory) =>
    cp(
      new URL(`../src/${directory}/`, import.meta.url),
      new URL(`../dist/${directory}/`, import.meta.url),
      { recursive: true, filter: (source) => !source.endsWith(".ts") },
    ),
  ),
);
