/** Measured execution facts of a browser eval turn and separate reviewer judgments; no model calls. */
type Message = { id: string; kind: string; created_at: string; content: any };
export type EfficiencyReview = {
  call_id: string;
  classification: "useful" | "avoidable" | "low_yield" | "failed";
  reasoning: string;
};
export type DiagnosedTurn = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  messages: Message[];
};

const categories = ["useful", "avoidable", "low_yield", "failed"] as const;
const seconds = (value: number) => Number(value.toFixed(3));

export function browserDiagnostics(
  turn: DiagnosedTurn,
  reviews: EfficiencyReview[] = [],
) {
  const reviewById = new Map(reviews.map((review) => [review.call_id, review]));
  if (reviewById.size !== reviews.length)
    throw new Error("Duplicate efficiency review call IDs.");
  const results = new Map(
    turn.messages
      .filter((message) => message.kind === "tool_result")
      .map((message) => [message.content.callId, message]),
  );
  const settled = ["completed", "failed"].includes(turn.status);
  let response = 0;
  const calls = turn.messages.flatMap((message) => {
    if (message.kind === "assistant") response++;
    if (message.kind !== "tool_call") return [];
    const result = results.get(message.content.callId);
    const output = result?.content.result;
    let args: any = {};
    try {
      args = JSON.parse(message.content.arguments || "{}");
    } catch {
      // Malformed arguments stay in the original evidence.
    }
    const start = Date.parse(message.created_at);
    const end = result ? Date.parse(result.created_at) : NaN;
    return [
      {
        message_id: message.id,
        call_id: message.content.callId as string,
        name: message.content.name as string,
        model_response: response,
        arguments: args,
        started_at: message.created_at,
        finished_at: (result?.created_at ?? null) as string | null,
        observed_seconds:
          Number.isFinite(start) && Number.isFinite(end)
            ? Math.max(0, end - start) / 1000
            : null,
        execution_status: !result
          ? settled
            ? "missing_result"
            : "pending"
          : output?.error || output?.ok === false
            ? "error"
            : "success",
        error: output?.error ?? null,
        result_characters:
          output === undefined ? 0 : JSON.stringify(output).length,
        observation: output?.observation ?? null,
        part: output?.part ?? null,
        no_change_reported: /no changes since/i.test(
          output?.changes ?? output?.snapshot ?? "",
        ),
        efficiency: reviewById.get(message.content.callId) ?? null,
      },
    ];
  });
  const callIds = new Set(calls.map((call) => call.call_id));
  for (const review of reviews)
    if (!callIds.has(review.call_id))
      throw new Error(`Review refers to unknown call ${review.call_id}`);

  // Union of persisted call→result intervals: concurrent tool time counts once.
  const intervals = calls
    .filter((call) => call.observed_seconds !== null)
    .map((call) => [Date.parse(call.started_at), Date.parse(call.finished_at!)])
    .sort((a, b) => a[0] - b[0]);
  let occupied = 0;
  let left = 0;
  let right = 0;
  for (const [start, end] of intervals) {
    if (start > right) {
      occupied += Math.max(0, right - left);
      left = start;
      right = end;
    } else right = Math.max(right, end);
  }
  occupied += Math.max(0, right - left);

  const wall = turn.finished_at
    ? (Date.parse(turn.finished_at) - Date.parse(turn.started_at)) / 1000
    : null;
  const errors = calls.filter((call) => call.execution_status === "error");
  const byTool = Object.fromEntries(
    [...new Set(calls.map((call) => call.name))].map((name) => {
      const group = calls.filter((call) => call.name === name);
      return [
        name,
        {
          calls: group.length,
          errors: group.filter((call) => call.execution_status === "error")
            .length,
          observed_seconds_sum: seconds(
            group.reduce((sum, call) => sum + (call.observed_seconds ?? 0), 0),
          ),
        },
      ];
    }),
  );
  return {
    schema_version: 1,
    turn_id: turn.id,
    measured: {
      wall_seconds: wall,
      model_responses: response,
      tool_calls: calls.length,
      successful_tool_calls: calls.filter(
        (call) => call.execution_status === "success",
      ).length,
      error_tool_calls: errors.length,
      error_rate: calls.length ? errors.length / calls.length : null,
      missing_results: calls.filter(
        (call) => call.execution_status === "missing_result",
      ).length,
      pending_calls: calls.filter((call) => call.execution_status === "pending")
        .length,
      tool_interval_union_seconds: occupied / 1000,
      outside_tool_intervals_seconds:
        wall === null ? null : Math.max(0, wall - occupied / 1000),
      no_change_responses: calls.filter((call) => call.no_change_reported)
        .length,
      snapshot_calls: calls.filter((call) => call.name === "browser_snapshot")
        .length,
      multipart_reads: calls.filter(
        (call) => call.name === "browser_snapshot" && call.arguments.part,
      ).length,
      by_tool: byTool,
    },
    reviewer_assessment: {
      reviewed_calls: reviews.length,
      unreviewed_calls: calls.length - reviews.length,
      counts: Object.fromEntries(
        categories.map((category) => [
          category,
          reviews.length
            ? reviews.filter((review) => review.classification === category)
                .length
            : null,
        ]),
      ),
      observed_seconds_by_classification: Object.fromEntries(
        categories.map((category) => [
          category,
          reviews.length
            ? seconds(
                calls
                  .filter((call) => call.efficiency?.classification === category)
                  .reduce((sum, call) => sum + (call.observed_seconds ?? 0), 0),
              )
            : null,
        ]),
      ),
      definitions: {
        useful:
          "Necessary setup/recovery/cleanup/delivery, or evidence that advanced the task; does not imply task success.",
        avoidable:
          "Reviewer identifies a specific call that added no necessary evidence or state change; this is a judgment, not an automatic counter.",
        low_yield:
          "Some information returned, but it did not resolve the failing requirements; not counted as confirmed waste.",
        failed:
          "A recorded tool error; failure alone does not prove the call was avoidable.",
      },
    },
    timing_scope:
      "Times are persisted call/result intervals, including dispatch/storage overhead. Time outside these intervals includes model execution and orchestration; it is not pure model latency. Per-call sums can overlap; union time avoids double counting.",
    calls,
  };
}
