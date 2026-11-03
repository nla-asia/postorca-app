import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import BrandMark from "./BrandMark";
import Sidebar from "./Sidebar";
import ConnectApps from "./ConnectApps";
import SettingsModal, { type SettingsTab } from "./SettingsModal";
import type { Page } from "../navigation";
import type { Theme } from "../lib/useTheme";
import { api, onAllowanceRequired, type AuthUser } from "../lib/api";
import { workState } from "../lib/useWorkTasks";
import type { Brand } from "../lib/brand";
import { useAgentChat } from "../lib/useAgentChat";
import InAppNotifications from "./InAppNotifications";
import Onboarding from "./Onboarding";
import { Button } from "./ui";
import Agent from "../pages/Agent";
import Inbox, { type InboxFilter } from "../pages/Inbox";
import WorkDetail from "./WorkDetail";
import { useWorkTasks } from "../lib/useWorkTasks";
import Routines from "../pages/Routines";
import Calendar from "../pages/Calendar";
import Posts from "../pages/Posts";
import ProjectDialog from "./ProjectDialog";
import BrandProfile from "../pages/BrandProfile";

export default function Workspace({
  user,
  onLogOut,
  theme,
  onThemeChange,
}: {
  user: AuthUser;
  onLogOut: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const initialNavigation = useRef(false);
  const [projectEditor, setProjectEditor] = useState<string | "new" | null>(
    null,
  );
  const [projectFilter, setProjectFilter] = useState("all");
  const [page, setPage] = useState<Page>("Inbox");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("General");
  const openBilling = useCallback(() => {
    setSettingsTab("Billing & Usage");
    setSettingsOpen(true);
  }, []);
  useEffect(() => onAllowanceRequired(openBilling), [openBilling]);
  const [connectAppsOpen, setConnectAppsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [profileName, setProfileName] = useState(user.name);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("review");
  const work = useWorkTasks(user.id);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandError, setBrandError] = useState("");
  const loadBrand = useCallback(async () => {
    try {
      const profile = await api<Brand>("/brand-profile");
      setBrand(profile);
      if (
        !initialNavigation.current &&
        profile.onboarding_status === "completed"
      ) {
        initialNavigation.current = true;
        if (profile.projects[0]) {
          setProjectId(profile.projects[0].id);
          setPage("Project");
        }
      }
      setProfileName(profile.name);
      setBrandError("");
    } catch (error) {
      setBrandError(
        error instanceof Error ? error.message : "Unable to load your brand.",
      );
    }
  }, []);
  useEffect(() => {
    void loadBrand();
  }, [loadBrand]);
  const completed = brand?.onboarding_status === "completed";
  // Only onboarding lives at workspace level; each project owns its agent chat.
  const chat = useAgentChat(
    brand && !completed ? user.id : undefined,
    "onboarding",
  );
  // Orca's tools change the profile, so re-read it after each turn.
  useEffect(() => {
    if (chat.ready && !chat.working) void loadBrand();
  }, [chat.ready, chat.working, loadBrand]);
  // Completing setup in this session shows what happens next before the app.
  const [setupDone, setSetupDone] = useState(false);
  const lastStatus = useRef<Brand["onboarding_status"] | null>(null);
  useEffect(() => {
    if (!brand) return;
    if (
      lastStatus.current &&
      lastStatus.current !== "completed" &&
      brand.onboarding_status === "completed"
    )
      setSetupDone(true);
    lastStatus.current = brand.onboarding_status;
  }, [brand?.onboarding_status]); // eslint-disable-line react-hooks/exhaustive-deps
  const openWork = (id: string) => {
    setSelected(id);
    setPage("Inbox");
    void work.reload();
  };
  // Clicking a desktop notification (work finished) opens its task.
  useEffect(
    () => window.postorca?.onOpenTask((taskId) => openWork(taskId)),
    [work.tasks], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  const settingsDialog = (
    <SettingsModal
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      tab={settingsTab}
      onTabChange={setSettingsTab}
      theme={theme}
      onThemeChange={onThemeChange}
      user={{ ...user, name: profileName }}
      onLogOut={onLogOut}
    />
  );
  if (!brand)
    return (
      <div className="auth-screen">
        <div className="auth-titlebar" />
        {brandError ? (
          <div className="auth-loading workspace-load-error" role="alert">
            <p>{brandError}</p>
            <Button onClick={() => void loadBrand()}>Try again</Button>
            <Button variant="ghost" onClick={onLogOut}>
              Log out
            </Button>
          </div>
        ) : (
          <div
            className="auth-loading"
            role="status"
            aria-label="Loading your brand"
          >
            <BrandMark large />
          </div>
        )}
      </div>
    );
  if (!completed || setupDone)
    return (
      <>
        <Onboarding
          chat={chat}
          brand={brand}
          completed={completed}
          onFinish={() => {
            setSetupDone(false);
            setSelected(null);
            const first = brand.projects[0];
            setProjectId(first?.id ?? null);
            setPage(first ? "Project" : "Inbox");
          }}
          onLogOut={onLogOut}
          onOpenBilling={openBilling}
        />
        {settingsDialog}
      </>
    );
  const project = brand.projects.find((item) => item.id === projectId);
  const filteredTasks =
    work.tasks?.filter(
      (task) =>
        projectFilter === "all" || task.project_id === projectFilter,
    ) ?? null;
  return (
    <div className="app-shell">
      <Sidebar
        projects={brand.projects}
        tasks={work.tasks ?? []}
        projectId={
          page === "Project"
            ? projectId
            : (work.tasks?.find((task) => task.id === selected)?.project_id ??
              null)
        }
        selectedTaskId={selected}
        onOpenProject={(id) => {
          setProjectId(id);
          setSelected(null);
          setPage("Project");
        }}
        onOpenTask={openWork}
        onAddProject={() => setProjectEditor("new")}
        user={{ ...user, name: profileName }}
        page={page}
        onNavigate={(next) => {
          setSelected(null);
          setPage(next);
        }}
        reviewCount={work.attention}
        onOpenConnectApps={() => setConnectAppsOpen(true)}
        onOpenSettings={() => {
          setSettingsTab("General");
          setSettingsOpen(true);
        }}
      />
      <main className="workspace" aria-label={page}>
        {/* The Inbox list already brings incoming work to the founder's attention.
            Unmount its notification queue here so old banners do not return later. */}
        {(page !== "Inbox" || selected) && (
          <InAppNotifications onOpen={openWork} />
        )}
        {page !== "Project" && !selected && (
          <header className="topbar">
            <h1 className="topbar-title">{page}</h1>
          </header>
        )}
        {page === "Project" && project && (
          <Agent
            key={project.id}
            userId={user.id}
            project={project}
            onSettings={() => setProjectEditor(project.id)}
            onTurnComplete={loadBrand}
          />
        )}
        {((page === "Inbox" && !selected) || page === "Calendar") && (
          <label className="project-filter">
            Project
            <select
              aria-label="Filter by project"
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="all">All projects</option>
              {brand.projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {page === "Inbox" && !selected && (
          <Inbox
            tasks={filteredTasks}
            error={work.error}
            onRetry={() => void work.reload()}
            reviewCount={
              (filteredTasks ?? []).filter((task) =>
                ["review", "failed"].includes(workState(task)),
              ).length
            }
            filter={filter}
            onFilterChange={setFilter}
            onSelect={openWork}
            onChanged={() => {
              void work.reload();
            }}
            notify={setNotice}
          />
        )}
        {page === "Inbox" && selected && (
          <WorkDetail
            key={selected}
            taskId={selected}
            founder={profileName}
            routineTitle={
              work.tasks?.find((task) => task.id === selected)?.routine_title
            }
            onBack={() => setSelected(null)}
            onOpenTask={openWork}
            onChanged={() => {
              void work.reload();
            }}
            notify={setNotice}
          />
        )}
        {page === "Routines" && (
          <Routines notify={setNotice} onOpenWork={openWork} />
        )}
        {page === "Calendar" && (
          <Calendar
            tasks={filteredTasks ?? []}
            projectFilter={projectFilter}
            onOpenWork={openWork}
            onApprovedSelect={openWork}
          />
        )}
        {page === "Posts" && <Posts notify={setNotice} />}
        {page === "Brand" && (
          <BrandProfile onNameChange={setProfileName} notify={setNotice} />
        )}
      </main>
      {projectEditor && (
        <ProjectDialog
          key={projectEditor}
          project={
            brand.projects.find((item) => item.id === projectEditor) ?? null
          }
          onClose={() => setProjectEditor(null)}
          onSaved={(saved) => {
            setBrand((current) =>
              current
                ? {
                    ...current,
                    projects: current.projects.some(
                      (item) => item.id === saved.id,
                    )
                      ? current.projects.map((item) =>
                          item.id === saved.id ? saved : item,
                        )
                      : [...current.projects, saved],
                  }
                : current,
            );
            setProjectId(saved.id);
            setSelected(null);
            setPage("Project");
          }}
          onDeleted={async () => {
            setBrand((current) =>
              current
                ? {
                    ...current,
                    projects: current.projects.filter(
                      (item) => item.id !== projectEditor,
                    ),
                  }
                : current,
            );
            if (projectId === projectEditor) {
              const next = brand.projects.find(
                (item) => item.id !== projectEditor,
              );
              setProjectId(next?.id ?? null);
              setPage(next ? "Project" : "Inbox");
            }
            await work.reload();
            setProjectFilter((current) =>
              current === projectEditor ? "all" : current,
            );
          }}
        />
      )}
      <ConnectApps open={connectAppsOpen} onOpenChange={setConnectAppsOpen} />
      {settingsDialog}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
