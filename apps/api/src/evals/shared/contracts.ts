import { z } from "zod";

export const verdictSchema = z.enum([
  "passed",
  "failed",
  "blocked",
  "awaiting_review",
]);
export type Verdict = z.infer<typeof verdictSchema>;
const matcher = z.union([
  z
    .object({
      operator: z.enum([
        "equals",
        "contains",
        "regex",
        "exists",
        "starts_with",
        "includes_any",
        "array_min_length",
        "min",
      ]),
      value: z.unknown().optional(),
    })
    .strict(),
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
]);
const assertion = z
  .object({
    tool_name: z.string().min(1),
    label: z.string().optional(),
    args: z.record(z.string(), matcher).optional(),
    result: z.record(z.string(), matcher).optional(),
    min_count: z.number().int().nonnegative().optional(),
    max_count: z.number().int().nonnegative().optional(),
    require_success: z.boolean().optional(),
  })
  .strict();
export const trajectorySchema = z
  .object({
    required_tool_calls: z.array(assertion).default([]),
    required_any_tool_calls: z
      .array(
        z
          .object({
            label: z.string(),
            alternatives: z.array(assertion).min(1),
          })
          .strict(),
      )
      .default([]),
    forbidden_tool_calls: z.array(assertion).default([]),
    max_tool_calls: z.number().int().nonnegative().optional(),
    max_failed_tool_calls: z.number().int().nonnegative().optional(),
  })
  .strict();
// Hooks are trusted observer programs. They receive the attempt folder as their last
// argument, emit JSON, and never receive the bearer token as an argument.
export const commandSchema = z
  .object({
    executable: z.string().min(1),
    args: z.array(z.string()).default([]),
    timeout_ms: z.number().int().positive().max(300_000).default(60_000),
  })
  .strict();
export const checkSchema = z
  .object({
    id: z.string().min(1),
    verdict: verdictSchema,
    reason: z.string().trim().min(1),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type Check = z.infer<typeof checkSchema>;
export const caseSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/),
    revision: z.number().int().positive().optional(),
    revision_change: z
      .object({
        from: z.number().int().positive(),
        reason: z.string().trim().min(1),
        preserved_coverage: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
    plugin: z.string().min(1),
    title: z.string().min(1),
    grading_mode: z.enum(["programmatic", "llm", "hybrid"]).default("hybrid"),
    turns: z
      .array(
        z
          .object({
            brief: z.string().min(1),
            video_case: z.string().optional(),
            video_expect: z.record(z.string(), z.any()).optional(),
            exports: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .min(1),
    criteria: z.array(
      z.object({ id: z.string().min(1), text: z.string().min(1) }).strict(),
    ),
    trajectory: trajectorySchema.default(() => trajectorySchema.parse({})),
    platform: z.enum(["win32", "darwin"]).optional(),
    /** 1: tool health check. 2: one process. 3: real-world end-to-end work. */
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    demo: z
      .object({
        id: z.string(),
        level: z.union([z.literal(2), z.literal(3)]),
        name: z.string(),
        app: z.enum(["maps", "clock", "simulator"]),
        brief: z.string(),
        typed: z.array(z.string()),
        min_clips: z.number().int().positive(),
        video: z
          .object({ seconds: z.tuple([z.number(), z.number()]) })
          .strict()
          .optional(),
        criteria: z.array(z.string()),
      })
      .strict()
      .optional(),
    prerequisites: z.array(z.string()).default([]),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .default(45 * 60_000),
    fixture: z
      .object({
        // Pin the actual input files/production bundle, not just a mutable directory name.
        files: z
          .array(
            z
              .object({
                path: z.string(),
                sha256: z.string().regex(/^[a-f0-9]{64}$/),
              })
              .strict(),
          )
          .min(1),
        prepare: commandSchema,
        observe: commandSchema,
        cleanup: commandSchema,
      })
      .strict()
      .optional(),
    verifier: commandSchema.optional(),
    source: z.string().optional(),
    computer: z
      .object({
        id: z.string(),
        attempt: z.number().int().positive(),
        nonce: z.string(),
        contract: z
          .object({
            id: z.string(),
            name: z.string(),
            brief: z.string(),
            expected: z.record(z.string(), z.any()),
            criteria: z.array(z.string()),
            manualReview: z.boolean(),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.revision ?? 1) > 1 && !value.revision_change)
      ctx.addIssue({
        code: "custom",
        message:
          "A revised case requires a correction note and preserved coverage",
      });
    if (new Set(value.criteria.map((c) => c.id)).size !== value.criteria.length)
      ctx.addIssue({ code: "custom", message: "Criterion IDs must be unique" });
    if (
      value.revision_change &&
      (!value.revision || value.revision_change.from >= value.revision)
    )
      ctx.addIssue({
        code: "custom",
        message: "A revision correction must identify an earlier version",
      });
    if (value.grading_mode !== "programmatic" && !value.criteria.length)
      ctx.addIssue({
        code: "custom",
        message: "Semantic grading requires criteria",
      });
    if (value.grading_mode === "programmatic" && value.criteria.length)
      ctx.addIssue({
        code: "custom",
        message: "Programmatic cases cannot have ungraded semantic criteria",
      });
    if (
      value.grading_mode === "programmatic" &&
      !value.verifier &&
      !value.computer &&
      !value.trajectory.required_tool_calls.length &&
      !value.trajectory.required_any_tool_calls.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Programmatic cases require an outcome assertion or verifier",
      });
    if (value.computer && value.computer.id !== value.computer.contract.id)
      ctx.addIssue({
        code: "custom",
        message: "Computer contract ID mismatch",
      });
    for (const turn of value.turns)
      if (turn.video_case && (!turn.video_expect || turn.exports === undefined))
        ctx.addIssue({
          code: "custom",
          message: "Video turns require frozen expectations and export count",
        });
    const assertions = [
      ...value.trajectory.required_tool_calls,
      ...value.trajectory.forbidden_tool_calls,
      ...value.trajectory.required_any_tool_calls.flatMap(
        (a) => a.alternatives,
      ),
    ];
    for (const a of assertions) {
      if (a.max_count !== undefined && a.max_count < (a.min_count ?? 1))
        ctx.addIssue({
          code: "custom",
          message: "Assertion maximum is less than minimum",
        });
      for (const rule of [
        ...Object.values(a.args ?? {}),
        ...Object.values(a.result ?? {}),
      ])
        if (
          rule &&
          typeof rule === "object" &&
          "operator" in rule &&
          rule.operator === "regex"
        ) {
          try {
            new RegExp(String(rule.value));
          } catch {
            ctx.addIssue({
              code: "custom",
              message: "Invalid assertion regular expression",
            });
          }
        }
    }
  });
export type EvalCase = z.infer<typeof caseSchema>;
export type Command = z.infer<typeof commandSchema>;
export type Call = {
  id: string;
  turn_id: string;
  name: string;
  args: any;
  result: any;
  failed: boolean;
};
export type Evidence = {
  task: any;
  calls: Call[];
  downloads: any[];
  collected_at: string;
};
export type Run = {
  schema_version: 1;
  id: string;
  case_id: string;
  created_at: string;
  api: string;
  model: string;
  platform: string;
  commit: string;
  dirty: string;
  fingerprint: string;
  case_hash: string;
  readiness: Record<string, { reason: string; checked_at: string }>;
  execution:
    "prepared" | "running" | "completed" | "failed" | "blocked" | "unknown";
  task_id?: string;
  task_launch_intent?: string;
  fixture_started?: boolean;
  fixture_cleaned?: boolean;
  started_at?: string;
  finished_at?: string;
  observer_error?: string;
  followups_stopped?: { after_turn: string; reason: string };
  steps: { intent_at: string; turn_id?: string }[];
  error?: string;
};
export const reviewSchema = z
  .object({
    evidence_hash: z.string(),
    case_hash: z.string(),
    reviewer: z.string().trim().min(1),
    criteria: z.array(checkSchema),
  })
  .strict();

/** Root-cause diagnosis is separate from acceptance. It cannot override a check. */
export const triageSchema = z
  .object({
    case_hash: z.string(),
    evidence_hash: z.string().nullable(),
    grading_hash: z.string(),
    reviewer: z.string().trim().min(1),
    findings: z
      .array(
        z
          .object({
            id: z.string().min(1),
            side: z.enum(["agent", "infrastructure", "eval", "unclassified"]),
            status: z.enum(["confirmed", "investigating"]),
            check_ids: z.array(z.string().min(1)).min(1),
            reason: z.string().trim().min(1),
            evidence: z.array(z.string().min(1)).min(1),
            next_action: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.findings.map((f) => f.id)).size !== value.findings.length)
      ctx.addIssue({ code: "custom", message: "Finding IDs must be unique" });
    if (
      value.findings.some(
        (f) => f.side === "unclassified" && f.status !== "investigating",
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Unclassified findings must remain investigating",
      });
  });
