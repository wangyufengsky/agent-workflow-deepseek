import { THEME_CONFIGS, THEME_IDS, themeCssVariables, type ThemeIdValue } from '@agent-workflow/shared';

/** localStorage key for the chosen theme. */
export const THEME_STORAGE_KEY = 'agent-workflow.theme';
/** URL query parameter that mirrors the chosen theme (shareable links). */
export const THEME_QUERY_KEY = 'theme';

export const DEFAULT_THEME: ThemeIdValue = 'deepseek';

export function isThemeId(value: unknown): value is ThemeIdValue {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function readThemeFromSearch(search: string): ThemeIdValue | null {
  const value = new URLSearchParams(search).get(THEME_QUERY_KEY);
  return isThemeId(value) ? value : null;
}

export function readStoredTheme(): ThemeIdValue | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(value) ? value : null;
  } catch {
    return null;
  }
}

/** URL wins over localStorage; falling back to the default theme. */
export function resolveInitialTheme(): ThemeIdValue {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const fromSearch = readThemeFromSearch(window.location.search);
  if (fromSearch !== null) return fromSearch;
  const stored = readStoredTheme();
  if (stored !== null) return stored;
  return DEFAULT_THEME;
}

/**
 * Writes the complete token set of one theme to <html> as CSS variables.
 * Components never hard-code colours; they read these variables.
 */
export function applyTheme(theme: ThemeIdValue): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const variables = themeCssVariables(theme);
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  const config = THEME_CONFIGS[theme];
  root.dataset.theme = theme;
  root.dataset.skin = theme;
  root.style.colorScheme = config.colorScheme;
}

/** Persists the theme to localStorage and mirrors it in the URL (?theme=). */
export function persistTheme(theme: ThemeIdValue): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); URL persistence still works.
  }
  const url = new URL(window.location.href);
  url.searchParams.set(THEME_QUERY_KEY, theme);
  window.history.replaceState(window.history.state, '', url);
}

export function themeLabel(theme: ThemeIdValue): string {
  return THEME_CONFIGS[theme].label;
}
