import { useEffect, useState } from "react";
import { ArrowRight, Check, Globe, LogOut } from "lucide-react";
import { Button, Platform } from "./ui";
import AgentChat, { Mark } from "./AgentChat";
import { describeDays } from "../pages/Routines";
import { api } from "../lib/api";
import type { Brand } from "../lib/brand";
import type { Routine } from "../lib/schedules";
import type { useAgentChat } from "../lib/useAgentChat";
import "./Onboarding.css";

/** Full-screen brand setup: the chat with Orca, then what happens next. */
export default function Onboarding({
  chat,
  brand,
  completed,
  onFinish,
  onLogOut,
  onOpenBilling,
}: {
  chat: ReturnType<typeof useAgentChat>;
  brand: Brand;
  /** The server recorded onboarding_status=completed. */
  completed: boolean;
  onFinish: () => void;
  onLogOut: () => void;
  onOpenBilling: () => void;
}) {
  return (
    <div className="onboarding-screen">
      <header className="onboarding-header">
        <Mark small />
        <h1>Set up your brand</h1>
        <Button variant="ghost" onClick={onOpenBilling}>
          Billing &amp; Usage
        </Button>
        {!completed && (
          <Button
            variant="ghost"
            className="onboarding-logout"
            onClick={onLogOut}
          >
            <LogOut size={15} aria-hidden="true" />
            Log out
          </Button>
        )}
      </header>
      {completed ? (
        <OnboardingDone brand={brand} onFinish={onFinish} />
      ) : (
        <div className="chat-page">
          <AgentChat chat={chat} />
        </div>
      )}
    </div>
  );
}

/** Display names for social link kinds, in the order platforms are offered. */
const PLATFORM_BY_KIND: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  threads: "Threads",
  facebook: "Facebook",
};
const PLATFORM_ORDER = Object.values(PLATFORM_BY_KIND);
const byPlatform = (a: string, b: string) =>
  PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b);

const shortUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (url.host.replace(/^www\./, "") + url.pathname).replace(/\/$/, "");
  } catch {
    return value;
  }
};

/** Default routines share a schedule across platforms, so show each once. */
type RoutineGroup = Pick<Routine, "title" | "time" | "days"> & {
  platforms: string[];
};
function groupRoutines(routines: Routine[]) {
  const groups = new Map<string, RoutineGroup>();
  for (const routine of routines) {
    const key = `${routine.title}|${routine.time}|${routine.days.join(",")}`;
    const group = groups.get(key) ?? { ...routine, platforms: [] };
    // A routine for every account (no platform) shows as "All accounts".
    if (routine.platform && !group.platforms.includes(routine.platform))
      group.platforms.push(routine.platform);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, platforms: group.platforms.sort(byPlatform) }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

function OnboardingDone({
  brand,
  onFinish,
}: {
  brand: Brand;
  onFinish: () => void;
}) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [routinesError, setRoutinesError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<Routine[]>("/routines")
      .then((list) => {
        if (!cancelled) setRoutines(list.filter((routine) => routine.active));
      })
      .catch(() => {
        if (!cancelled) setRoutinesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const accounts = brand.links
    .filter((link) => PLATFORM_BY_KIND[link.kind])
    .sort((a, b) =>
      byPlatform(PLATFORM_BY_KIND[a.kind], PLATFORM_BY_KIND[b.kind]),
    );
  const websites = brand.links.filter((link) => !PLATFORM_BY_KIND[link.kind]);
  const first = routines
    ?.filter((routine) => routine.next_run_at)
    .sort((a, b) => a.next_run_at!.localeCompare(b.next_run_at!))[0];
  return (
    <div className="onboarding-done">
      <div className="onboarding-done-panel">
        <span className="onboarding-done-icon">
          <Check size={22} strokeWidth={2} aria-hidden="true" />
        </span>
        <h2>You’re all set</h2>
        <p className="onboarding-done-lead">
          Orca now knows your brand and will start working on your accounts. You
          can change any of this later in Brand Profile.
        </p>
        <section className="onboarding-card">
          <div className="onboarding-section">
            <span className="onboarding-label">Building</span>
            <p>{brand.company}</p>
          </div>
          <div className="onboarding-section">
            <span className="onboarding-label">Topics</span>
            <p>{brand.topics}</p>
          </div>
          <div className="onboarding-section">
            <span className="onboarding-label">Accounts</span>
            <ul className="onboarding-accounts">
              {accounts.map((link) => (
                <li key={link.id ?? link.url} title={link.url}>
                  <Platform name={PLATFORM_BY_KIND[link.kind]} />
                  {shortUrl(link.url).replace(/^[^/]+\/(in\/)?/, "")}
                </li>
              ))}
              {websites.map((link) => (
                <li key={link.id ?? link.url} title={link.url}>
                  <span className="platform website">
                    <Globe size={13} aria-hidden="true" />
                  </span>
                  {shortUrl(link.url)}
                </li>
              ))}
            </ul>
          </div>
          <div className="onboarding-section">
            <span className="onboarding-label">Orca’s schedule</span>
            {routinesError ? (
              <p className="muted">
                Your routines couldn’t be loaded right now. You’ll find them in
                Routines.
              </p>
            ) : routines === null ? (
              <p className="muted" role="status">
                Loading…
              </p>
            ) : routines.length === 0 ? (
              <p className="muted">
                Nothing is scheduled yet. Ask Orca to set up a routine.
              </p>
            ) : (
              <ul className="onboarding-schedule">
                {groupRoutines(routines).map((routine) => (
                  <li key={`${routine.title}|${routine.time}`}>
                    <span className="onboarding-schedule-title">
                      {routine.title}
                    </span>
                    <span className="onboarding-schedule-when">
                      {describeDays(routine.days)} · {routine.time}
                    </span>
                    <span className="onboarding-schedule-platforms">
                      {routine.platforms.length
                        ? routine.platforms.map((platform) => (
                            <Platform key={platform} name={platform} />
                          ))
                        : "All accounts"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <div className="onboarding-done-footer">
          {first && (
            <p>
              First up: <strong>{first.title}</strong>,{" "}
              {new Date(first.next_run_at!).toLocaleString(undefined, {
                weekday: "long",
                hour: "numeric",
                minute: "2-digit",
              })}
              . Results land in your Inbox.
            </p>
          )}
          <Button
            variant="primary"
            className="onboarding-cta"
            onClick={onFinish}
          >
            Go to Inbox
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
