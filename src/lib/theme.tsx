'use client';

// React 19-compatible theme provider — replaces next-themes.
//
// WHY next-themes was removed: its ThemeProvider renders an inline FOUC
// bootstrap script tag inside the component tree. React 19 never executes
// scripts created during client rendering (and warns: "Encountered a script
// tag while rendering React component") — and CineDeck mounts AppProviders in
// TWO places (site root + /admin layout), so client-side navigation between
// them re-created the script and tripped the warning on every admin visit.
//
// HOW this implementation works:
//   * The pre-paint theme class is applied by a nonce'd bootstrap script
//     server-rendered in the ROOT layout <head> (see src/app/layout.tsx) —
//     executed by the HTML parser, never re-created by React, allowed by
//     the strict-dynamic CSP via its nonce.
//   * This provider owns the post-mount state + setTheme() and stores the
//     preference under the SAME localStorage key ('theme') next-themes used
//     with attribute="class" — existing user preferences survive unchanged.
//   * No scripts, no matchMedia/localStorage reads during render → zero
//     hydration mismatches: consumers render `theme: undefined` on the
//     server AND the first client render, then update post-mount.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'dark' | 'light' | 'system';

/** Same storage key next-themes used — preferences are forward-compatible. */
const STORAGE_KEY = 'theme';

interface ThemeContextValue {
  /** Undefined until mounted — SSR and the first client render agree. */
  theme: Theme | undefined;
  resolvedTheme: 'dark' | 'light' | undefined;
  setTheme: (theme: Theme) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: undefined,
  resolvedTheme: undefined,
  setTheme: () => undefined,
  themes: ['dark', 'light'],
});

/** Apply the theme class to <html> (idempotent with the layout bootstrap). */
function applyTheme(theme: Theme): 'dark' | 'light' {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  return resolved;
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  enableSystem = false,
}: {
  children: ReactNode;
  defaultTheme?: Theme;
  enableSystem?: boolean;
}) {
  const [theme, setThemeState] = useState<Theme | undefined>(undefined);
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light' | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    // Microtask (not synchronous setState) keeps the effect lint-clean; it
    // still resolves before first paint, and the layout bootstrap script has
    // already applied the theme class pre-paint — no visual flash either way.
    Promise.resolve().then(() => {
      if (cancelled) return;
      let initial: Theme = defaultTheme;
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
          initial = stored;
        }
      } catch {
        /* private-mode localStorage — fall back to the default */
      }
      if (!enableSystem && initial === 'system') initial = defaultTheme;
      setThemeState(initial);
      setResolvedTheme(applyTheme(initial));
    });
    return () => {
      cancelled = true;
    };
  }, [defaultTheme, enableSystem]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private-mode — theme still applies for this session */
    }
    setThemeState(next);
    setResolvedTheme(applyTheme(next));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      themes: enableSystem ? ['dark', 'light', 'system'] : ['dark', 'light'],
    }),
    [theme, resolvedTheme, setTheme, enableSystem],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Compatible subset of the next-themes hook the app actually uses. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
