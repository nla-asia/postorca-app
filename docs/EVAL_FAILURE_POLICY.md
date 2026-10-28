# Eval failure investigation and correction

The purpose of evaluation is to find defects. A failed run can reveal an agent
mistake, an infrastructure/product-tool defect, an eval defect, or several of
these together. The goal is a reliable product under a valid measurement, not a
green result obtained by changing the measurement.

## Separate execution, acceptance, and diagnosis

- **Product execution:** did the actual product turn finish? This comes from
  retained task evidence. A recovered tool error does not by itself mean the
  turn failed. The original observer execution record is preserved separately.
- **Acceptance:** did every required outcome, safety constraint, and declared
  budget pass? Execution completion is not acceptance. A case can expressly
  require zero tool errors through `max_failed_tool_calls: 0`; that rule still
  fails when an error occurs.
- **Diagnosis:** why did a requirement fail, a prerequisite block execution, or a
  tool error occur? Investigation adds evidence and proposed remediation. It
  never overrides acceptance or deletes an error.

The shared runner retains a conservative stop before further paid follow-ups
when the previous turn had tool errors or missing prerequisite deliverables.
The completed turn is still recorded as completed; missing declared follow-ups
remain unmet outcomes. Investigate that stop separately from the agent's actions.

## Three possible causes

| Side | Evidence needed | Appropriate correction |
| --- | --- | --- |
| `agent` | A functioning tool/environment was available, but the agent chose invalid arguments, misunderstood the request, omitted required work, invented results, or failed to recover appropriately. | Fix general behavior, planning, skill guidance or tool affordances. Validate on multiple inputs and fresh held-out tasks. |
| `infrastructure` | The intended action could not run because of unavailable services/accounts, broken transport, provider failures, lost execution, or a product tool rejecting valid supported input. | Repair the affected service, transport or tool, independently verify readiness, then run a fresh attempt where execution changed. |
| `eval` | The task and rubric disagree, the fixture is incorrect, evidence is missing because the observer failed, or the grader asserts something the evidence does not support. | Repair the measurement with a documented justification and regression checks, preserving original attempts and the intended capability coverage. |

A tool error is not automatically an agent error. For example, an invalid file
path rejected according to the documented scope is an agent selection mistake;
a valid supported path wrongly rejected by a broken resolver is a tool defect
on the infrastructure side. Diagnose from the request, tool contract, result and
independent state rather than the presence of an error string.

`unclassified` with `investigating` status means insufficient evidence; it is not
a fourth root-cause category. Multiple findings may describe mixed causes. A
recovered agent error can be worth fixing even when all user outcomes pass.

## Required investigation record

Use `triage-template.json` after grading and semantic review. Every failed or
blocked check and every retained tool-error diagnostic must be covered by a
finding. Each finding records side, investigation status, evidence references,
reasoning, and a concrete next action. Uncertain findings remain unclassified.

```sh
npm run eval -- inspect <attempt-id>
npm run eval -- triage <attempt-id> --triage .data/diagnosis.json
npm run eval -- report
```

The diagnosis binds to the frozen case, current evidence, grading policy/checks
and current issue list. Evidence or judgment changes invalidate stale diagnoses.
Reports retain raw verdicts and expose root-cause findings separately. An
eval-defective failure is not evidence of an agent reliability failure, and it is
not an agent success either. Do not count raw failed attempts as agent failures
without this investigation.

## Rules for fixes

1. Preserve the original brief, fixture inputs, criteria, execution record,
   evidence, errors and judgments. No silent rewrites or assisted completions.
2. State the defect and justify the correction from the task/capability contract
   and evidence. "The agent failed" is not a justification for changing a rubric.
3. Never remove a valid requirement, inflate a budget, simplify a fixture, hide a
   failed attempt, or grant an exception merely to get a pass.
4. Never insert expected answers, exact eval paths, fixture IDs, hardcoded
   locators or case-specific tool sequences into the production prompt to teach
   the answer. Keep evaluator knowledge outside the agent's context.
5. Test the smallest justified fix with positive and negative cases. A correction
   must still reject genuinely wrong outcomes, not just accept the observed one.
6. Version measurement changes. Case changes apply to future attempts, with a
   recorded revision reason and explicit coverage preservation. Existing frozen
   cases retain their original requirements.
7. Regrade retained evidence only for a justified grader correction. Record its
   reason and archive the old judgments. Revalidate semantic reviews when checks
   change. A new execution, runtime/model change, fixture change or prompt change
   requires a fresh attempt; regrading cannot establish performance after it.
8. Preserve unsuccessful attempts after the fix and report the full history.
   Passing one example is not proof of general reliability.

## Grading policy 2 and the public-download correction

Policy 1 treated any tool error as failed execution even when the product turn
completed. Policy 2 reads terminal product evidence and retains errors as
diagnostics, with declared error budgets enforced independently. A policy change
does not automatically rewrite stored reports or silently reuse old approvals:

```sh
npm run eval -- regrade <attempt-id> --reason "Evidence-based grader correction"
```

`inspect` and `report` flag older stored policies as requiring explicit regrade.
The original result is archived, the correction is recorded as a lifecycle event,
and case and execution JSON are unchanged. Reports group by case/runtime/contract
and grading-policy version so differently graded histories are distinguishable.

The public-download case's revision 1 required browser discovery even though its
user request only asked for three public files and previews. That hidden
procedural restriction was not a valid way to judge the business outcome.
Revision 2 leaves the user brief unchanged and retains all original-byte,
delivery, authentication, transport-control and cleanup requirements. Its case
manifest records the correction reason and the preserved coverage case.

Mandatory browser-session transfer remains in the existing, unchanged
`browser-session-downloads` case: the request actually calls for the existing
session, the resources are cookie-protected, and anonymous requests must fail.
Direct downloads of public copies cannot pass that case. This preserves the
capability test without forcing a preferred route into an unrelated user task.

The original public-download pilot was regraded under its **unchanged revision 1
contract**. Product execution is now correctly completed, its real file-access
error remains visible, and the original browser-discovery criterion still fails.
Triage records both the eval-design defect and the agent's scoped-file mistake.
The notebook remains passed. No fresh revision 2 success or agent improvement is
claimed, and no additional model execution was needed for this correction.
