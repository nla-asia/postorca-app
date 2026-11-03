import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Plus,
  Plug,
  Settings2,
} from "lucide-react";
import { navigation, type Page } from "../navigation";
import { api, type AuthUser } from "../lib/api";
import type { BrandProject } from "../lib/brand";
import type { WorkTask } from "../lib/schedules";
import "./Projects.css";
import { Button } from "./ui";

export default function Sidebar({
  projects,
  tasks,
  projectId,
  selectedTaskId,
  onOpenProject,
  onOpenTask,
  onAddProject,
  page,
  onNavigate,
  onOpenConnectApps,
  onOpenSettings,
  user,
  reviewCount = 0,
}: {
  projects: BrandProject[];
  tasks: WorkTask[];
  projectId: string | null;
  selectedTaskId: string | null;
  onOpenProject: (id: string) => void;
  onOpenTask: (id: string) => void;
  onAddProject: () => void;
  page: Page;
  onNavigate: (page: Page) => void;
  onOpenConnectApps: () => void;
  onOpenSettings: () => void;
  user: AuthUser;
  reviewCount?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<{ userId: string; name: string } | null>(
    null,
  );
  useEffect(() => {
    let active = true,
      inFlight = false;
    const controller = new AbortController();
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const billing = await api<{
          status: string;
          plan: "builder" | "influencer" | null;
          packages: Record<"builder" | "influencer", { name: string }>;
        }>("/billing", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (active)
          setPlan({
            userId: user.id,
            name:
              billing.plan && ["active", "trialing"].includes(billing.status)
                ? billing.packages[billing.plan].name
                : "Free",
          });
      } catch {
        if (active)
          setPlan((previous) =>
            previous?.userId === user.id
              ? previous
              : { userId: user.id, name: "Plan unavailable" },
          );
      } finally {
        inFlight = false;
      }
    };
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [user.id]);

  return (
    <aside className="sidebar" aria-label="Workspace sidebar">
      <div className="window-drag sidebar-logo-area">
        <div className="sidebar-logo">
          <span className="sidebar-logo-text">PostOrca</span>
        </div>
      </div>
      <nav aria-label="Main navigation">
        {navigation.map(({ name, icon: Icon }) => (
          <button
            type="button"
            key={name}
            className={`nav-item ${page === name ? "active" : ""}`}
            aria-current={page === name ? "page" : undefined}
            onClick={() => onNavigate(name)}
          >
            <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>{name}</span>
            {name === "Inbox" && reviewCount > 0 && (
              <span className="nav-count">{reviewCount}</span>
            )}
          </button>
        ))}
      </nav>
      <section className="sidebar-projects" aria-label="Projects">
        <div className="sidebar-section-heading">
          <span>Projects</span>
          <button
            className="icon-button"
            aria-label="Add project"
            onClick={onAddProject}
          >
            <Plus size={16} />
          </button>
        </div>
        {projects.length === 0 && (
          <button className="project-empty" onClick={onAddProject}>
            Add your first project
          </button>
        )}
        {projects.map((project) => {
          const expanded = !collapsed.has(project.id);
          const recent = tasks.filter(
            (task) => task.project_id === project.id && !task.archived_at,
          );
          return (
            <div key={project.id} className="sidebar-project-group">
              <div
                className={`sidebar-project-row ${projectId === project.id ? "active" : ""}`}
              >
                <button
                  className="project-disclosure"
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`}
                  aria-expanded={expanded}
                  onClick={() =>
                    setCollapsed((previous) => {
                      const next = new Set(previous);
                      if (!next.delete(project.id)) next.add(project.id);
                      return next;
                    })
                  }
                >
                  {expanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                <button
                  className="project-name"
                  title={`Open ${project.name} chat`}
                  aria-current={
                    page === "Project" && projectId === project.id
                      ? "page"
                      : undefined
                  }
                  onClick={() => onOpenProject(project.id)}
                >
                  <FolderOpen size={17} />
                  <span>{project.name}</span>
                </button>
              </div>
              {expanded && (
                <div className="sidebar-project-tasks">
                  {recent
                    .slice(0, showAll.has(project.id) ? undefined : 5)
                    .map((task) => (
                      <button
                        key={task.id}
                        title={task.title}
                        className={`project-task ${selectedTaskId === task.id ? "active" : ""}`}
                        onClick={() => onOpenTask(task.id)}
                      >
                        <span>{task.title}</span>
                        {["queued", "running"].includes(task.status ?? "") && (
                          <span
                            className="project-task-dot"
                            aria-label="Working"
                          />
                        )}
                      </button>
                    ))}
                  {recent.length > 5 && (
                    <button
                      className="project-task project-more"
                      onClick={() =>
                        setShowAll((current) => {
                          const next = new Set(current);
                          if (!next.delete(project.id)) next.add(project.id);
                          return next;
                        })
                      }
                    >
                      {showAll.has(project.id) ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
      <div className="sidebar-bottom">
        <Button
          type="button"
          className="connect-apps-trigger"
          onClick={onOpenConnectApps}
        >
          <Plug size={16} aria-hidden="true" />
          <span>Connect Apps</span>
        </Button>
        <button
          type="button"
          className="profile-button"
          onClick={onOpenSettings}
          aria-haspopup="dialog"
          aria-label={`Open settings for ${user.name}`}
        >
          <span className="avatar" aria-hidden="true">
            {user.name.charAt(0).toUpperCase() || "N"}
          </span>
          <span>
            <strong>{user.name || "Your profile"}</strong>
            <small>
              {plan?.userId === user.id ? plan.name : "Loading plan…"}
            </small>
          </span>
          <Settings2 size={17} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
