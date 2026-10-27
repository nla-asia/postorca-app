import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import Sidebar from "./Sidebar";
import AppearanceSettings from "./AppearanceSettings";
import type { Page } from "../navigation";
import type { Theme } from "../lib/useTheme";
import type { AuthUser } from "../lib/api";
import Agent from "../pages/Agent";
import Inbox, { type InboxFilter } from "../pages/Inbox";
import WorkDetail from "./WorkDetail";
import { useWorkTasks } from "../lib/useWorkTasks";
import Routines from "../pages/Routines";
import Calendar from "../pages/Calendar";
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
  const [page, setPage] = useState<Page>("Inbox");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [profileName, setProfileName] = useState(user.name);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("For review");
  const work = useWorkTasks(user.id);
  const openWork = (id: string) => {
    setSelected(id);
    setPage("Inbox");
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <div className="app-shell">
      <Sidebar
        user={{ ...user, name: profileName }}
        onLogOut={onLogOut}
        page={page}
        onNavigate={(next) => {
          setSelected(null);
          setPage(next);
        }}
        reviewCount={work.attention}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace" aria-label={page}>
        {page !== "Agent" && !(page === "Inbox" && selected) && (
          <header className="topbar">
            <div className="breadcrumb">
              Your space <ChevronRight size={13} aria-hidden="true" />
              <span>{page}</span>
            </div>
          </header>
        )}
        {page === "Agent" && <Agent />}
        {page === "Inbox" && !selected && (
          <Inbox
            tasks={work.tasks}
            error={work.error}
            onRetry={() => void work.reload()}
            reviewCount={work.attention}
            filter={filter}
            onFilterChange={setFilter}
            onSelect={openWork}
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
            onChanged={() => void work.reload()}
            notify={setNotice}
          />
        )}
        {page === "Routines" && (
          <Routines notify={setNotice} onOpenWork={openWork} />
        )}
        {page === "Calendar" && (
          <Calendar
            tasks={work.tasks ?? []}
            onOpenWork={openWork}
            onApprovedSelect={openWork}
          />
        )}
        {page === "Brand Profile" && (
          <BrandProfile onNameChange={setProfileName} />
        )}
      </main>
      <AppearanceSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        theme={theme}
        onThemeChange={onThemeChange}
      />
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
