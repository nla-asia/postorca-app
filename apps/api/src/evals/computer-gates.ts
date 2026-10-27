import { computerCaseOrder, type ComputerCaseId } from "./computer-cases.js";
import { createHash } from "node:crypto";
/** Keep grading changes separate from changes to the agent/desktop execution. */
export function executionFingerprint(
  hashes: Record<string, string>,
  model: string,
  platform: string,
) {
  const execution = Object.fromEntries(
    Object.entries(hashes)
      .filter(
        ([file]) =>
          !file.startsWith("apps/api/src/evals/") &&
          file !== "apps/api/src/scripts/computer-eval.ts",
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash("sha256")
    .update(JSON.stringify({ execution, model, platform }))
    .digest("hex");
}
export type GateRun = {
  caseId: ComputerCaseId;
  fingerprint: string;
  verdict: string;
  folder: string;
};
export function passingStreak(
  runs: GateRun[],
  id: ComputerCaseId,
  fingerprint: string,
) {
  let count = 0;
  for (const run of runs.filter((r) => r.caseId === id).reverse()) {
    if (run.fingerprint !== fingerprint || run.verdict !== "passed") break;
    count++;
  }
  return count;
}
export function assertGate(
  runs: GateRun[],
  id: ComputerCaseId,
  fingerprint: string,
) {
  for (const previous of computerCaseOrder.slice(
    0,
    computerCaseOrder.indexOf(id),
  )) {
    const streak = passingStreak(runs, previous, fingerprint);
    if (streak < 3)
      throw new Error(
        `${previous} needs three consecutive passes on this runtime before ${id}; current streak ${streak}.`,
      );
  }
}
