/** Platform-independent evidence and runner contracts; no app-specific grading. */
export type ComputerEvalCase<Id extends string = string> = {
  id: Id;
  name: string;
  brief: string;
  expected: Record<string, any>;
  criteria: string[];
  manualReview: boolean;
};
export type EvalCall = { name: string; args: any; result: any };
export type EvalCheck = { name: string; passed: boolean; details?: unknown };
export type EvalEvidence = {
  status: string;
  calls: EvalCall[];
  final: string;
  artifacts: any[];
  observed: any;
  controlReleased: boolean;
};

export type ComputerEvalRun<Id extends string = string> = {
  caseId: Id;
  fingerprint: string;
  verdict: string;
  folder: string;
};
export type ComputerEvalSuite<Id extends string> = {
  prepare?: (entry: ComputerEvalCase<Id>, folder: string) => Promise<unknown>;
  observe?: (
    entry: ComputerEvalCase<Id>,
    folder: string,
    baseline: any,
  ) => Promise<Record<string, unknown>>;
  platform: "darwin" | "win32";
  root: string;
  files: string[];
  caseOrder: readonly Id[];
  createCase: (id: Id, attempt: number, nonce: string) => ComputerEvalCase<Id>;
  grade: (entry: ComputerEvalCase<Id>, evidence: EvalEvidence) => EvalCheck[];
  passingStreak: (
    runs: ComputerEvalRun<Id>[],
    id: Id,
    fingerprint: string,
  ) => number;
  assertGate: (
    runs: ComputerEvalRun<Id>[],
    id: Id,
    fingerprint: string,
  ) => void;
  executionFingerprint: (
    hashes: Record<string, string>,
    model: string,
    platform: string,
  ) => string;
};
