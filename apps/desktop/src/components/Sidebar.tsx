import { useEffect, useState } from "react";
import { Plug, Settings2, Wallet } from "lucide-react";
import logoUrl from "../assets/logo.png";
import { navigation, type Page } from "../navigation";
import { api, type AuthUser } from "../lib/api";
import { Button } from "./ui";

export default function Sidebar({
  page,
  onNavigate,
  onOpenConnectApps,
  onOpenSettings,
  onOpenBilling,
  user,
  reviewCount = 0,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  onOpenConnectApps: () => void;
  onOpenSettings: () => void;
  onOpenBilling: () => void;
  user: AuthUser;
  reviewCount?: number;
}) {
  const [plan, setPlan] = useState<{ userId: string; name: string } | null>(null);
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
          packages: { membership: { name: string } };
        }>("/billing", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (active)
          setPlan({
            userId: user.id,
            name: ["active", "trialing"].includes(billing.status)
              ? billing.packages.membership.name
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
          <span className="sidebar-logo-icon" aria-hidden="true">
            <img src={logoUrl} alt="" width={44} height={44} />
          </span>
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
      <div className="sidebar-bottom">
        <Button
          className="connect-apps-trigger"
          onClick={onOpenBilling}
          aria-haspopup="dialog"
        >
          <Wallet size={16} aria-hidden="true" />
          <span>Billing &amp; Usage</span>
        </Button>
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
            <small>{plan?.userId === user.id ? plan.name : "Loading plan…"}</small>
          </span>
          <Settings2 size={17} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
