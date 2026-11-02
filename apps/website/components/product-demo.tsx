"use client";
import { useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Inbox,
  MessageSquare,
  Plus,
  Reply,
  Settings2,
  Target,
  Wrench,
} from "lucide-react";
import { Mark } from "./brand";
const views = ["Agent", "Inbox", "Calendar", "Routines"] as const;
const icons = [MessageSquare, Inbox, CalendarDays, Clock3];
const work = [
  {
    title: "Ledgerly launch video",
    platform: "LinkedIn",
    type: "Video",
    text: "30 seconds on the whole product, from your code and your real app.",
  },
  {
    title: "New in Ledgerly: overdue invoices",
    platform: "X",
    type: "Script for review",
    text: "The feature you shipped yesterday, in four shots.",
  },
  {
    title: "How to share a packing list",
    platform: "Instagram",
    type: "How-to reel",
    text: "The steps users asked about, shown on the iPhone.",
  },
];
export function ProductDemo() {
  const [view, setView] = useState<(typeof views)[number]>("Inbox");
  const [selected, setSelected] = useState<number | null>(null);
  const [approved, setApproved] = useState(false);
  const [following, setFollowing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sent, setSent] = useState(false);
  const [paused, setPaused] = useState(false);
  const [chat, setChat] = useState("");
  const [asked, setAsked] = useState(false);
  const openTask = (index: number) => {
    setSelected(index);
    setApproved(false);
    setFollowing(false);
    setSent(false);
  };
  return (
    <div className="desktop-demo" aria-label="Interactive PostOrca product example">
      <aside className="demo-sidebar">
        <div className="window-controls" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>POSTORCA</span>
        </div>
        <div className="demo-nav" role="tablist" aria-label="Explore PostOrca">
          {views.map((item, index) => {
            const Icon = icons[index];
            return (
              <button
                key={item}
                role="tab"
                aria-selected={view === item}
                tabIndex={view === item ? 0 : -1}
                aria-controls="demo-panel"
                id={`demo-${item}`}
                className={view === item ? "active" : ""}
                onClick={() => {
                  setView(item);
                  setSelected(null);
                }}
                onKeyDown={(event) => {
                  if (
                    ![
                      "ArrowDown",
                      "ArrowUp",
                      "ArrowLeft",
                      "ArrowRight",
                      "Home",
                      "End",
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 3
                        : (index +
                            (["ArrowDown", "ArrowRight"].includes(event.key)
                              ? 1
                              : 3)) %
                          4;
                  setView(views[next]);
                  setSelected(null);
                  document.getElementById(`demo-${views[next]}`)?.focus();
                }}
              >
                <Icon size={17} />
                {item}
                {item === "Inbox" && <span className="nav-count">3</span>}
              </button>
            );
          })}
        </div>
        <div className="demo-brand">
          <Target size={17} />
          <span>Brand Profile</span>
        </div>
        <div className="demo-account">
          <span className="avatar">A</span>
          <span>
            Alex Morgan<small>Personal workspace</small>
          </span>
          <Settings2 size={15} />
        </div>
      </aside>
      <div
        className="demo-main"
        role="tabpanel"
        id="demo-panel"
        aria-labelledby={`demo-${view}`}
      >
        <header className="demo-header">
          {selected !== null ? (
            <button
              className="back"
              onClick={() => setSelected(null)}
              aria-label="Back to example inbox"
            >
              <ArrowLeft size={17} />
            </button>
          ) : (
            <Mark />
          )}
          <span>
            {selected !== null
              ? work[selected].title
              : view === "Agent"
                ? "Orca"
                : view}
          </span>
          {view === "Inbox" && selected === null && (
            <span className="demo-header-note">3 for review</span>
          )}
        </header>
        {view === "Inbox" && selected === null && (
          <div className="demo-inbox">
            <div className="inbox-filter">
              <span>
                For review <b>3</b>
              </span>
              <span>Approved</span>
              <span>All activity</span>
            </div>
            {work.map((item, index) => (
              <button
                className="demo-task"
                key={item.title}
                onClick={() => openTask(index)}
              >
                <span className="task-symbol">
                  {index === 0 ? (
                    <FileText size={21} />
                  ) : index === 1 ? (
                    <MessageSquare size={21} />
                  ) : (
                    <CalendarDays size={21} />
                  )}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.text}</small>
                  <em>
                    {item.platform}
                    <i /> {item.type}
                  </em>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
            <div className="review-hint">
              <span className="status-dot" />
              Ready when you are.
            </div>
          </div>
        )}
        {view === "Inbox" && selected !== null && (
          <div className="demo-thread">
            <div className="thread-card">
              <div className="thread-author">
                <span className="avatar">A</span>
                <strong>Alex</strong>
              </div>
              <p>
                {selected === 0
                  ? "I haven't posted anything about Ledgerly yet. Can you make a launch video for LinkedIn?"
                  : selected === 1
                    ? "I just shipped overdue invoices. Can you make a short announcement?"
                    : "Users asked how to share their packing list. Can you make a quick how-to?"}
              </p>
              <div className="thread-reply">
                <div className="thread-author">
                  <span className="asia-avatar">
                    <Mark />
                  </span>
                  <strong>Orca</strong>
                </div>
                <details className="action-example">
                  <summary>
                    <Wrench size={14} />3 actions<span>18s</span>
                    <ChevronDown size={14} />
                  </summary>
                  <p>
                    Read the project and recent commits
                    <br />
                    Opened the running app
                    <br />
                    Prepared work for review
                  </p>
                </details>
                <p>
                  {selected === 0
                    ? "Here's your launch video: the main journey from a new invoice to getting paid, with voiceover and captions. The script you approved, the recordings and the video are in its folder."
                    : selected === 1
                      ? "Here's the script: what's new on screen in the first shot, where you meet it on the dashboard, the Overdue badge, and why it helps. Approve it or tell me what to change."
                      : "Sharing is on the iPhone, so the steps are shown in the Simulator: open the trip, tap Share packing list, pick who to send it to."}
                </p>
                <div className="artifact-example">
                  <FileText size={17} />
                  <span>
                    {selected === 0
                      ? "Ledgerly launch.mp4"
                      : selected === 1
                        ? "script.md"
                        : "Packlight how-to.mp4"}
                  </span>
                  <ChevronRight size={14} />
                </div>
              </div>
            </div>
            {sent ? (
              <p className="demo-confirmation" role="status">
                <Check size={15} />
                Feedback sent to Orca.
              </p>
            ) : following ? (
              <form
                className="demo-followup"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (feedback.trim()) setSent(true);
                }}
              >
                <input
                  aria-label="Example feedback"
                  placeholder="What would you like to change?"
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                />
                <button
                  aria-label="Send example feedback"
                  disabled={!feedback.trim()}
                >
                  <ArrowUp size={16} />
                </button>
              </form>
            ) : (
              <div className="demo-work-actions">
                <button onClick={() => setFollowing(true)}>
                  <Reply size={14} />
                  Follow Up
                </button>
                <button
                  className={approved ? "is-approved" : ""}
                  onClick={() => setApproved(true)}
                >
                  <Check size={14} />
                  {approved ? "Approved" : "Approve"}
                </button>
                <button onClick={() => setSelected(null)}>
                  <Archive size={14} />
                  Archive
                </button>
              </div>
            )}
          </div>
        )}
        {view === "Agent" && (
          <div className="demo-chat">
            <div className="chat-user">
              {asked
                ? chat
                : "I just shipped a new feature. Can you make a short video about it?"}
            </div>
            <div className="chat-reply">
              <span className="asia-avatar">
                <Mark />
              </span>
              <div>
                <strong>Orca</strong>
                <p>
                  {asked
                    ? "I'll read your project and open the running app, then write the script for you to approve. Nothing is recorded until you say go."
                    : "I'll find it in your latest commits and open the app to see where users meet it."}
                </p>
                <p>Then a short script for you to approve, and the video once you do.</p>
              </div>
            </div>
            <form
              className="demo-composer"
              onSubmit={(event) => {
                event.preventDefault();
                if (chat.trim()) setAsked(true);
              }}
            >
              <Plus size={17} />
              <input
                value={asked ? "" : chat}
                onChange={(event) => {
                  setAsked(false);
                  setChat(event.target.value);
                }}
                aria-label="Try the example conversation"
                placeholder="Ask Orca a question…"
              />
              <button
                aria-label="Send example message"
                disabled={!chat.trim() || asked}
              >
                <ArrowUp size={16} />
              </button>
            </form>
          </div>
        )}
        {view === "Calendar" && (
          <div className="demo-calendar">
            <div>
              <strong>October 2026</strong>
              <span>
                Schedule task <Plus size={13} />
              </span>
            </div>
            <div className="mini-week">
              {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => (
                <span key={i}>{day}</span>
              ))}
            </div>
            <div className="mini-grid">
              {Array.from({ length: 35 }, (_, i) => (
                <div key={i}>
                  <span className={i === 23 ? "current-day" : ""}>
                    {i >= 3 && i < 34 ? i - 2 : ""}
                  </span>
                  {[23, 25, 28].includes(i) && (
                    <button
                      onClick={() => {
                        setView("Inbox");
                        openTask(i === 23 ? 0 : i === 25 ? 1 : 2);
                      }}
                    >
                      <b>{i === 23 ? "09:00" : "10:00"}</b>
                      {i === 23
                        ? "Launch video"
                        : i === 25
                          ? "Feature launch"
                          : "How-to reel"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {view === "Routines" && (
          <div className="demo-routines">
            <div className="routine-example">
              <div>
                <span className="platform-example">@</span>
                <span>Threads</span>
                <button
                  className={`demo-switch ${paused ? "" : "on"}`}
                  role="switch"
                  aria-checked={!paused}
                  aria-label="Example daily routine"
                  onClick={() => setPaused(!paused)}
                >
                  <span />
                </button>
              </div>
              <h3>Ideas from my work</h3>
              <p>
                Check what changed in your projects and suggest what's worth a
                video.
              </p>
              <footer>
                <Clock3 size={14} />
                <span>09:00 · Every weekday</span>
                <b>{paused ? "Paused" : "Active"}</b>
              </footer>
            </div>
            <div className="routine-example">
              <div>
                <span className="platform-example">𝕏</span>
                <span>X</span>
                <span className="routine-active">Active</span>
              </div>
              <h3>How my posts did</h3>
              <p>
                Read how last week's posts did and what people responded to.
              </p>
              <footer>
                <Clock3 size={14} />
                <span>10:00 · Every Monday</span>
              </footer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
