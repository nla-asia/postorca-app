import { cp } from "node:fs/promises";

await Promise.all(
  ["migrations", "agent/prompts"].map((directory) =>
    cp(
      new URL(`../src/${directory}/`, import.meta.url),
      new URL(`../dist/${directory}/`, import.meta.url),
      { recursive: true },
    ),
  ),
);
