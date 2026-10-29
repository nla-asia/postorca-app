/** Mac-only cases and pass history. Shares platform-independent transport/evidence collection. */
import { runComputerEval } from "./computer-eval-runner.js";
import {
  macComputerCaseOrder,
  macComputerCase,
  gradeMacComputer,
} from "../evals/computer-mac-cases.js";
import {
  assertMacGate,
  macPassingStreak,
  macExecutionFingerprint,
} from "../evals/computer-mac-gates.js";

await runComputerEval({
  platform: "darwin",
  root: ".data/computer-evals-mac",
  files: [
    "apps/api/src/evals/computer-mac-cases.ts",
    "apps/api/src/evals/computer-mac-gates.ts",
    "apps/api/src/evals/computer-eval-types.ts",
    "apps/api/src/scripts/computer-eval-mac.ts",
  ],
  caseOrder: macComputerCaseOrder,
  createCase: macComputerCase,
  grade: gradeMacComputer,
  assertGate: assertMacGate,
  passingStreak: macPassingStreak,
  executionFingerprint: macExecutionFingerprint,
});
