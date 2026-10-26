import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import Sidebar from "./components/Sidebar";
import EmptyWorkspace from "./components/EmptyWorkspace";
import AppearanceSettings from "./components/AppearanceSettings";
import { navigation, type Page } from "./navigation";
import { useTheme } from "./lib/useTheme";
import Agent from "./pages/Agent";
import Inbox from "./pages/Inbox";
import Routines from "./pages/Routines";

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
  const current = navigation.find((item) => item.name === page)!;
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
        {page === "Agent" ? (
          <Agent />
        ) : page === "Inbox" ? (
          <Inbox />
        ) : page === "Routines" ? (
          <Routines notify={setNotice} onOpenWork={() => setPage("Inbox")} />
        ) : (
          <EmptyWorkspace item={current} />
        )}
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
