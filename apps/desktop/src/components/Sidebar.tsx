import { Settings2 } from "lucide-react";
import { navigation, type Page } from "../navigation";
export default function Sidebar({
  page,
  onNavigate,
  onOpenSettings,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className="sidebar" aria-label="Workspace sidebar">
      <div className="sidebar-brand">
        <span className="wordmark">PostOrca</span>
        <span className="brand-caption">Personal Brand Agent</span>
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
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button
          type="button"
          className="settings-trigger"
          onClick={onOpenSettings}
          aria-haspopup="dialog"
        >
          <Settings2 size={18} strokeWidth={1.7} aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
