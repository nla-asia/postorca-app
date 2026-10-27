import BillingUsage from "./BillingUsage";
import { useEffect, useState } from "react";
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
  onOpenBrandProfile,
  tab,
  onTabChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  user: AuthUser;
  onLogOut: () => void;
  onOpenBrandProfile?: () => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}) {
  const [workingFolder, setWorkingFolder] = useState<string | null>(null);
  useEffect(() => {
    if (open) void window.postorca?.workingFolder.get().then(setWorkingFolder);
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Make this space your own."
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

              <span className="field-section-label">Workspace</span>
              <div className="settings-group">
                <div className="setting-row">
                  <div>
                    <strong>Brand profile</strong>
                    <p>{user.name || "Your profile"} · Personal workspace</p>
                  </div>
                  {onOpenBrandProfile && (
                    <Button
                      onClick={() => {
                        onOpenChange(false);
                        onOpenBrandProfile();
                      }}
                    >
                      Edit profile
                    </Button>
                  )}
                </div>
                {window.postorca && (
                  <div className="setting-row">
                    <div>
                      <strong>Working folder</strong>
                      <p>
                        {workingFolder ??
                          "Not set. Orca can only use files in this folder and your project folders."}
                      </p>
                    </div>
                    <Button
                      onClick={async () => {
                        const chosen =
                          await window.postorca?.workingFolder.choose();
                        if (chosen) setWorkingFolder(chosen);
                      }}
                    >
                      {workingFolder ? "Change" : "Choose folder"}
                    </Button>
                  </div>
                )}
              </div>
              <div className="preview-notice">
                Appearance is saved on this device.
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
              <Button
                className="account-billing-link"
                onClick={() => onTabChange("Billing & Usage")}
              >
                <Wallet size={15} aria-hidden="true" />
                Billing &amp; Usage
              </Button>
            </>
          )}

          {tab === "Billing & Usage" && <BillingUsage />}

          {tab === "Help" && (
            <div className="settings-group">
              <div className="setting-row">
                <div>
                  <strong>Working with your agent</strong>
                  <p>
                    Use Agent to develop your brand direction and content ideas.
                    Review proposals in your Inbox, see planned content in the
                    Calendar, and manage your agent’s rhythm in Routines.
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
