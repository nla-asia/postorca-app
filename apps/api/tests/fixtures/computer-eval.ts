import { runComputerEval } from "../../src/scripts/computer-eval-runner.js";
import { computerCaseOrder, computerCase, gradeComputer } from "../../src/evals/computer-cases.js";
import { assertGate, passingStreak, executionFingerprint } from "../../src/evals/computer-gates.js";

const root = process.env.POSTORCA_TEST_EVAL_DIR;
if (!root) throw new Error("The CLI test requires an isolated evidence folder.");
await runComputerEval({
  platform: "win32",
  root,
  files: [
    "apps/api/src/evals/computer-cases.ts",
    "apps/api/src/evals/computer-gates.ts",
    "apps/api/src/evals/computer-eval-types.ts",
    "apps/api/src/scripts/computer-eval.ts",
  ],
  caseOrder: computerCaseOrder,
  createCase: computerCase,
  grade: gradeComputer,
  assertGate,
  passingStreak,
  executionFingerprint,
});
