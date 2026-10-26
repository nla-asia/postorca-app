import { useState } from "react";
import { CheckCheck } from "lucide-react";
import "./Inbox.css";
import "../components/tabs.css";

const tabs = ["For review", "Approved", "All activity"] as const;

export default function Inbox() {
  const [filter, setFilter] = useState<(typeof tabs)[number]>("For review");
  // Task loading will be connected when the work API is available.
  const reviewCount = 0;
  return (
    <div className="page-content inbox-page">
      <div className="section-toolbar">
        <div className="tabs" role="tablist" aria-label="Inbox filters">
          {tabs.map((tab, index) => (
            <button
              type="button"
              key={tab}
              id={`inbox-tab-${index}`}
              role="tab"
              aria-selected={filter === tab}
              aria-controls="inbox-results"
              tabIndex={filter === tab ? 0 : -1}
              className={filter === tab ? "selected" : ""}
              onClick={() => setFilter(tab)}
              onKeyDown={(event) => {
                if (
                  !["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                setFilter(tabs[next]);
                document.getElementById(`inbox-tab-${next}`)?.focus();
              }}
            >
              {tab}
              {tab === "For review" && <span>{reviewCount}</span>}
            </button>
          ))}
        </div>
      </div>
      <div
        className="proposal-list"
        id="inbox-results"
        role="tabpanel"
        aria-labelledby={`inbox-tab-${tabs.indexOf(filter)}`}
      >
        <div className="empty-state">
          <CheckCheck size={30} aria-hidden="true" />
          <h3>
            {filter === "Approved"
              ? "Good ideas start here"
              : "You’re all caught up"}
          </h3>
          <p>
            {filter === "Approved"
              ? "Work you approve will appear here."
              : "Work from your routines will show up here."}
          </p>
        </div>
      </div>
      <p className="preview-note">
        Preview · Your work will appear here once your agent is connected.
      </p>
    </div>
  );
}
