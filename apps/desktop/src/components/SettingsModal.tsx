import BillingUsage from "./BillingUsage";
import {
  CircleHelp,
  LogOut,
  Monitor,
  Moon,
  Settings2,
  Sun,
  UserRound,
  Wallet,
} from "lucide-react";
import type { Theme } from "../lib/useTheme";
import type { AuthUser } from "../lib/api";
import { Button, Modal } from "./ui";

export type SettingsTab = "General" | "Account" | "Billing & Usage" | "Help";

const themes = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function SettingsModal({
  open,
  onOpenChange,
  theme,
  onThemeChange,
  user,
  onLogOut,
  tab,
  onTabChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  user: AuthUser;
  onLogOut: () => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Your account, plan and app preferences."
      wide
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings navigation">
          {[
            { label: "General" as const, icon: Settings2 },
            { label: "Account" as const, icon: UserRound },
            { label: "Billing & Usage" as const, icon: Wallet },
            { label: "Help" as const, icon: CircleHelp },
          ].map(({ label, icon: Icon }) => (
            <button
              type="button"
              key={label}
              className={tab === label ? "active" : ""}
              aria-current={tab === label ? "true" : undefined}
              onClick={() => onTabChange(label)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab !== "Billing & Usage" && <h3>{tab}</h3>}

          {tab === "General" && (
            <>
              <span className="field-section-label">Appearance</span>
              <div className="settings-group">
                <div className="setting-row">
                  <div>
                    <strong>Theme</strong>
                    <p>A space that feels right, day or night.</p>
                  </div>
                </div>
                <div className="theme-options">
                  {themes.map(({ value, label, icon: Icon }) => (
                    <button
                      type="button"
                      key={value}
                      className={`theme-option ${theme === value ? "chosen" : ""}`}
                      onClick={() => onThemeChange(value)}
                    >
                      <span
                        className={`theme-preview ${value}`}
                        aria-hidden="true"
                      >
                        <i />
                        <b />
                        <em />
                      </span>
                      <span>
                        <Icon size={14} aria-hidden="true" />
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <span className="field-section-label">About</span>
              <div className="settings-group">
                <div className="setting-row">
                  <div>
                    <strong>PostOrca</strong>
                    <p>Version {__APP_VERSION__}</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === "Account" && (
            <>
              <div className="settings-group">
                <div className="setting-row">
                  <div>
                    <strong>{user.name}</strong>
                    <p>{user.email}</p>
                  </div>
                </div>
                <div className="setting-row">
                  <Button onClick={onLogOut}>
                    <LogOut size={15} aria-hidden="true" />
                    <span>Log out</span>
                  </Button>
                </div>
              </div>
            </>
          )}

          {tab === "Billing & Usage" && <BillingUsage />}

          {tab === "Help" && (
            <div className="settings-group">
              <div className="setting-row">
                <div>
                  <strong>Support</strong>
                  <p>
                    Questions or problems? Email{" "}
                    <a
                      href="mailto:nla@autopilotstartup.com"
                      target="_blank"
                      rel="noreferrer"
                    >
                      nla@autopilotstartup.com
                    </a>
                    .
                  </p>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>About this version</strong>
                  <p>
                    PostOrca runs on the server and desktop. Gmail and Google
                    Drive connectors connect your workspace to your files and
                    email.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
