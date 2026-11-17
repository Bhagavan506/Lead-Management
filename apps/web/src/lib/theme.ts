import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "lb.theme";

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
}

/** Light, dark, or follow the device. Stored per browser; storage failures just mean it isn't remembered. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => apply(theme), [theme]);
  const set = useCallback((t: Theme) => {
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      /* private mode etc. */
    }
    setTheme(t);
  }, []);
  const cycle = useCallback(
    () => set(theme === "system" ? "light" : theme === "light" ? "dark" : "system"),
    [theme, set],
  );
  return { theme, set, cycle };
}
