import { useLayoutEffect, useState } from "react";
export type Theme = "light" | "dark" | "system";
const storageKey = "postorca-theme";
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "light" || saved === "dark" || saved === "system")
        return saved;
    } catch {
      // Appearance still works when local storage is unavailable.
    }
    return "system";
  });
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      // Retain the preference in memory for this session.
    }
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme] as const;
}
