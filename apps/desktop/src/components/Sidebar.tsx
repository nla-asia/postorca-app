import { LogOut, Settings2 } from "lucide-react";
import { navigation, type Page } from "../navigation";
import type { AuthUser } from "../lib/api";
export default function Sidebar({
  page,
  onNavigate,
  onOpenSettings,
  user,
  onLogOut,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  onOpenSettings: () => void;
  user: AuthUser;
  onLogOut: () => void;
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
        <div className="account-summary">
          <span className="account-avatar" aria-hidden="true">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div className="account-label">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onLogOut}
            aria-label="Log out"
          >
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
