import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** step is the model response number; compaction calls use e.g. "3-compaction". */
export type TurnTrace = {
  taskId: string;
  turnId: string;
  step: number | string;
};
const root = fileURLToPath(
  new URL("../../.data/agent-traces/", import.meta.url),
);

export function turnTraceDirectory(trace: TurnTrace) {
  return join(root, trace.taskId, trace.turnId);
}

/** Local diagnostics only: never include credentials or HTTP headers. */
export async function writeTurnTrace(
  trace: TurnTrace | undefined,
  part: "request" | "result" | "error",
  data: unknown,
) {
  if (!trace) return;
  const directory = turnTraceDirectory(trace);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      join(directory, `${String(trace.step).padStart(2, "0")}.${part}.json`),
      JSON.stringify(data, null, 2) + "\n",
      { mode: 0o600 },
    );
    if (trace.step === 1 && part === "request")
      console.info(`Agent turn trace: ${directory}`);
  } catch {
    // Diagnostics must not prevent or repeat model/tool execution.
    console.warn(
      `Could not write agent trace for turn ${trace.turnId}, step ${trace.step}.`,
    );
  }
}
