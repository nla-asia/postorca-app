import { createHash } from "node:crypto";
import type { ComputerEvalRun } from "./computer-eval-types.js";
import {
  macComputerCaseOrder,
  type MacComputerCaseId,
} from "./computer-mac-cases.js";

export type MacGateRun = ComputerEvalRun<MacComputerCaseId>;
export function macExecutionFingerprint(
  hashes: Record<string, string>,
  model: string,
  platform: string,
) {
  const execution = Object.fromEntries(
    Object.entries(hashes)
      .filter(
        ([file]) =>
          !file.startsWith("apps/api/src/evals/") &&
          file !== "apps/api/src/scripts/computer-eval-mac.ts",
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash("sha256")
    .update(
      JSON.stringify({ suite: "computer-mac", execution, model, platform }),
    )
    .digest("hex");
}
export function macPassingStreak(
  runs: MacGateRun[],
  id: MacComputerCaseId,
  fingerprint: string,
) {
  let count = 0;
  for (const run of runs.filter((r) => r.caseId === id).reverse()) {
    if (run.fingerprint !== fingerprint || run.verdict !== "passed") break;
    count++;
  }
  return count;
}
export function assertMacGate(
  runs: MacGateRun[],
  id: MacComputerCaseId,
  fingerprint: string,
) {
  if (!macComputerCaseOrder.includes(id))
    throw new Error(`Unknown Mac case: ${id}`);
  for (const previous of macComputerCaseOrder.slice(
    0,
    macComputerCaseOrder.indexOf(id),
  )) {
    const streak = macPassingStreak(runs, previous, fingerprint);
    if (streak < 3)
      throw new Error(
        `${previous} needs three consecutive Mac passes before ${id}; current streak ${streak}.`,
      );
  }
}
