import { Monitor, Moon, Sun } from "lucide-react";
import { Button, Modal } from "./ui";
import type { Theme } from "../lib/useTheme";
const choices = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;
export default function AppearanceSettings({
  open,
  onOpenChange,
  theme,
  onThemeChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Make this space your own."
    >
      <fieldset className="appearance">
        <legend>Appearance</legend>
        <p>Choose how PostOrca looks on this device.</p>
        <div className="theme-options">
          {choices.map(({ value, label, icon: Icon }) => (
            <label
              key={value}
              className={`theme-option ${theme === value ? "chosen" : ""}`}
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => onThemeChange(value)}
              />
              <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p>
          System follows your device’s appearance. Your preference is saved on
          this device.
        </p>
      </fieldset>
      <div className="modal-footer">
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      </div>
    </Modal>
  );
}
