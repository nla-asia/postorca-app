/** Windows computer-use evals with retained evidence and staged app gates. */
import { runComputerEval } from "./computer-eval-runner.js";
import {
  computerCaseOrder,
  computerCase,
  gradeComputer,
} from "../evals/computer-cases.js";
import {
  assertGate,
  passingStreak,
  executionFingerprint,
} from "../evals/computer-gates.js";

await runComputerEval({
  platform: "win32",
  root: ".data/computer-evals",
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
