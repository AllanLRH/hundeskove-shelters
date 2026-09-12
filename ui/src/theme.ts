/**
 * Light / dark / system theme, persisted across visits.
 *
 * Three states, not two. "System" is a real choice — it tracks the OS as it
 * changes through the day — so the toggle cycles through it rather than forcing
 * a permanent decision on first click.
 *
 * The chosen theme is stamped on <html> as `data-theme`; absence of the
 * attribute means "follow the system", which is what the CSS media query
 * handles.
 */

export type Theme = "system" | "light" | "dark";

/** Must stay in step with the pre-paint script in index.html. */
export const STORAGE_KEY = "hundeskove:theme";
const ORDER: Theme[] = ["system", "light", "dark"];

const LABEL: Record<Theme, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

const ICON: Record<Theme, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

function stored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // Private browsing can throw on access; falling back to system is fine.
  }
  return "system";
}

function persist(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not being able to remember the choice is not worth breaking the page for.
  }
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** Wire up the toggle button and restore the remembered choice. */
export function initTheme(button: HTMLButtonElement): void {
  let theme = stored();

  const paint = (): void => {
    apply(theme);
    button.textContent = `${ICON[theme]} ${LABEL[theme]}`;
    button.title = `Theme: ${LABEL[theme]}. Click to switch.`;
    button.setAttribute("aria-label", `Theme: ${LABEL[theme]}. Click to switch.`);
  };

  button.addEventListener("click", () => {
    theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
    persist(theme);
    paint();
  });

  paint();
}
