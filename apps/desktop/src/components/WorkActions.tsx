import {
  AlertCircle,
  Check,
  ChevronRight,
  LoaderCircle,
  Wrench,
} from "lucide-react";

import type { WorkAction } from "../lib/toolActions";
export type { WorkAction };
export default function WorkActions({
  actions,
  seconds,
  working = false,
}: {
  actions: WorkAction[];
  /** Total turn duration, when finished. */
  seconds?: number | null;
  working?: boolean;
}) {
  // While working, the summary names the step in progress so progress is visible.
  const current = working ? actions.at(-1)?.label : undefined;
  return (
    <details className="work-actions">
      <summary>
        <span className="action-tool-icon">
          {working ? (
            <LoaderCircle className="loading-icon" size={17} />
          ) : (
            <Wrench size={17} />
          )}
        </span>
        <strong className={current ? "action-current" : undefined}>
          {current ??
            `${actions.length} ${actions.length === 1 ? "action" : "actions"}`}
        </strong>
        <span className="action-duration">
          {working ? "Working" : seconds != null ? `${seconds}s` : "–"}
        </span>
        <ChevronRight className="action-chevron" size={17} />
      </summary>
      <div className="action-details">
        {actions.length ? (
          <ol>
            {actions.map((action, index) => (
              <li key={index} title={action.detail}>
                {action.pending ? (
                  <LoaderCircle className="loading-icon" size={14} />
                ) : action.failed ? (
                  <AlertCircle size={14} />
                ) : (
                  <Check size={14} />
                )}
                <span>{action.label}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>
            {working
              ? "Orca hasn’t used any tools yet."
              : "Orca answered without using tools."}
          </p>
        )}
      </div>
    </details>
  );
}
