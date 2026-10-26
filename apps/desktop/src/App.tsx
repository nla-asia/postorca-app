import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import Sidebar from "./components/Sidebar";
import AppearanceSettings from "./components/AppearanceSettings";
import type { Page } from "./navigation";
import { useTheme } from "./lib/useTheme";
import Agent from "./pages/Agent";
import Inbox from "./pages/Inbox";
import Routines from "./pages/Routines";
import Calendar from "./pages/Calendar";
import BrandProfile from "./pages/BrandProfile";

export default function App() {
  const [page, setPage] = useState<Page>("Inbox");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        onNavigate={setPage}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace" aria-label={page}>
        {page !== "Agent" && (
          <header className="topbar">
            <div className="breadcrumb">
              Your space <ChevronRight size={13} aria-hidden="true" />
              <span>{page}</span>
            </div>
          </header>
        )}
        {page === "Agent" && <Agent />}
        {page === "Inbox" && <Inbox />}
        {page === "Routines" && (
          <Routines notify={setNotice} onOpenWork={() => setPage("Inbox")} />
        )}
        {page === "Calendar" && (
          <Calendar
            tasks={[]}
            onOpenWork={() => setPage("Inbox")}
            onApprovedSelect={() => setNotice("Work details are coming soon.")}
          />
        )}
        {page === "Brand Profile" && <BrandProfile />}
      </main>
      <AppearanceSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        theme={theme}
        onThemeChange={setTheme}
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
