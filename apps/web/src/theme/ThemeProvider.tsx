import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThemeIdValue } from '@agent-workflow/shared';
import { applyTheme, persistTheme, readThemeFromSearch, readStoredTheme, resolveInitialTheme } from './theme.ts';

export interface ThemeContextValue {
  /** Currently applied theme. */
  readonly theme: ThemeIdValue;
  /** Applies + persists a theme (writes CSS variables, data-theme, localStorage and URL). */
  readonly setTheme: (theme: ThemeIdValue) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeIdValue>(() => resolveInitialTheme());

  const setTheme = useCallback((next: ThemeIdValue) => {
    applyTheme(next);
    persistTheme(next);
    setThemeState(next);
  }, []);

  // Keep the document in sync even if a child re-renders before the setter runs.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Browser back/forward changes ?theme=; follow the URL unless it is absent
  // (then fall back to the persisted choice).
  useEffect(() => {
    const handlePopState = () => {
      const next = readThemeFromSearch(window.location.search) ?? readStoredTheme() ?? 'deepseek';
      applyTheme(next);
      setThemeState(next);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return value;
}
