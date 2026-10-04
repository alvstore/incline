import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type ThemeId =
  | 'default'
  | 'emerald'
  | 'rose'
  | 'amber'
  | 'slate'
  | 'ocean'
  | 'violet'
  | 'midnight'
  | 'crimson'
  | 'graphite';

export type SidebarMode = 'light' | 'dark';
export type DarkMode = 'light' | 'dark' | 'system';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  gradient: [string, string];
  vars: Record<string, string>;
  lightSidebarVars: Record<string, string>;
}

const THEMES: ThemeDefinition[] = [
  {
    id: 'default',
    name: 'Indigo',
    gradient: ['#1e3a5f', '#f97316'],
    vars: {
      '--primary': '222 47% 11%',
      '--primary-foreground': '210 40% 98%',
      '--accent': '24 95% 53%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '24 95% 53%',
      '--sidebar-background': '222 47% 11%',
      '--sidebar-foreground': '210 40% 98%',
      '--sidebar-primary': '24 95% 53%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '222 47% 18%',
      '--sidebar-accent-foreground': '210 40% 98%',
      '--sidebar-border': '222 47% 18%',
      '--sidebar-ring': '24 95% 53%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '222 47% 11%',
      '--sidebar-primary': '222 47% 11%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '210 20% 96%',
      '--sidebar-accent-foreground': '222 47% 11%',
      '--sidebar-border': '214 32% 91%',
      '--sidebar-ring': '24 95% 53%',
    },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    gradient: ['#065f46', '#10b981'],
    vars: {
      '--primary': '160 84% 39%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '160 84% 39%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '160 84% 39%',
      '--sidebar-background': '160 50% 12%',
      '--sidebar-foreground': '0 0% 95%',
      '--sidebar-primary': '160 84% 45%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '160 40% 18%',
      '--sidebar-accent-foreground': '0 0% 95%',
      '--sidebar-border': '160 40% 18%',
      '--sidebar-ring': '160 84% 45%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '160 50% 12%',
      '--sidebar-primary': '160 84% 39%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '160 20% 96%',
      '--sidebar-accent-foreground': '160 50% 12%',
      '--sidebar-border': '160 20% 90%',
      '--sidebar-ring': '160 84% 39%',
    },
  },
  {
    id: 'rose',
    name: 'Rose',
    gradient: ['#9f1239', '#fb7185'],
    vars: {
      '--primary': '346 77% 50%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '346 77% 50%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '346 77% 50%',
      '--sidebar-background': '346 30% 12%',
      '--sidebar-foreground': '0 0% 95%',
      '--sidebar-primary': '346 77% 55%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '346 25% 18%',
      '--sidebar-accent-foreground': '0 0% 95%',
      '--sidebar-border': '346 25% 18%',
      '--sidebar-ring': '346 77% 55%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '346 30% 12%',
      '--sidebar-primary': '346 77% 50%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '346 15% 96%',
      '--sidebar-accent-foreground': '346 30% 12%',
      '--sidebar-border': '346 15% 90%',
      '--sidebar-ring': '346 77% 50%',
    },
  },
  {
    id: 'amber',
    name: 'Amber',
    gradient: ['#92400e', '#f59e0b'],
    vars: {
      '--primary': '38 92% 50%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '38 92% 50%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '38 92% 50%',
      '--sidebar-background': '38 30% 10%',
      '--sidebar-foreground': '0 0% 95%',
      '--sidebar-primary': '38 92% 55%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '38 25% 16%',
      '--sidebar-accent-foreground': '0 0% 95%',
      '--sidebar-border': '38 25% 16%',
      '--sidebar-ring': '38 92% 55%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '38 30% 10%',
      '--sidebar-primary': '38 92% 50%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '38 20% 96%',
      '--sidebar-accent-foreground': '38 30% 10%',
      '--sidebar-border': '38 20% 90%',
      '--sidebar-ring': '38 92% 50%',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    gradient: ['#0c4a6e', '#0ea5e9'],
    vars: {
      '--primary': '199 89% 48%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '199 89% 48%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '199 89% 48%',
      '--sidebar-background': '199 40% 10%',
      '--sidebar-foreground': '0 0% 95%',
      '--sidebar-primary': '199 89% 52%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '199 30% 16%',
      '--sidebar-accent-foreground': '0 0% 95%',
      '--sidebar-border': '199 30% 16%',
      '--sidebar-ring': '199 89% 52%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '199 40% 10%',
      '--sidebar-primary': '199 89% 48%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '199 15% 96%',
      '--sidebar-accent-foreground': '199 40% 10%',
      '--sidebar-border': '199 15% 90%',
      '--sidebar-ring': '199 89% 48%',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    gradient: ['#1e293b', '#64748b'],
    vars: {
      '--primary': '215 20% 40%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '215 20% 40%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '215 20% 40%',
      '--sidebar-background': '215 20% 10%',
      '--sidebar-foreground': '0 0% 95%',
      '--sidebar-primary': '215 20% 50%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '215 18% 16%',
      '--sidebar-accent-foreground': '0 0% 95%',
      '--sidebar-border': '215 18% 16%',
      '--sidebar-ring': '215 20% 50%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '215 20% 10%',
      '--sidebar-primary': '215 20% 40%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '215 10% 96%',
      '--sidebar-accent-foreground': '215 20% 10%',
      '--sidebar-border': '215 10% 90%',
      '--sidebar-ring': '215 20% 40%',
    },
  },
  {
    id: 'violet',
    name: 'Violet',
    gradient: ['#4c1d95', '#8b5cf6'],
    vars: {
      '--primary': '263 70% 50%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '263 70% 60%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '263 70% 60%',
      '--sidebar-background': '263 40% 10%',
      '--sidebar-foreground': '0 0% 96%',
      '--sidebar-primary': '263 70% 58%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '263 30% 17%',
      '--sidebar-accent-foreground': '0 0% 96%',
      '--sidebar-border': '263 30% 17%',
      '--sidebar-ring': '263 70% 58%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '263 40% 10%',
      '--sidebar-primary': '263 70% 50%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '263 20% 96%',
      '--sidebar-accent-foreground': '263 40% 10%',
      '--sidebar-border': '263 20% 90%',
      '--sidebar-ring': '263 70% 50%',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    gradient: ['#0f172a', '#38bdf8'],
    vars: {
      '--primary': '213 94% 68%',
      '--primary-foreground': '0 0% 5%',
      '--accent': '213 94% 68%',
      '--accent-foreground': '0 0% 5%',
      '--ring': '213 94% 68%',
      '--sidebar-background': '222 84% 5%',
      '--sidebar-foreground': '213 60% 90%',
      '--sidebar-primary': '213 94% 68%',
      '--sidebar-primary-foreground': '0 0% 5%',
      '--sidebar-accent': '220 70% 10%',
      '--sidebar-accent-foreground': '213 60% 90%',
      '--sidebar-border': '220 70% 10%',
      '--sidebar-ring': '213 94% 68%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '222 84% 5%',
      '--sidebar-primary': '213 94% 68%',
      '--sidebar-primary-foreground': '0 0% 5%',
      '--sidebar-accent': '213 20% 96%',
      '--sidebar-accent-foreground': '222 84% 5%',
      '--sidebar-border': '213 20% 90%',
      '--sidebar-ring': '213 94% 68%',
    },
  },
  {
    id: 'crimson',
    name: 'Crimson',
    gradient: ['#7f1d1d', '#ef4444'],
    vars: {
      '--primary': '0 72% 51%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '0 72% 51%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '0 72% 51%',
      '--sidebar-background': '0 40% 10%',
      '--sidebar-foreground': '0 0% 95%',
      '--sidebar-primary': '0 72% 56%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '0 30% 16%',
      '--sidebar-accent-foreground': '0 0% 95%',
      '--sidebar-border': '0 30% 16%',
      '--sidebar-ring': '0 72% 56%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '0 40% 10%',
      '--sidebar-primary': '0 72% 51%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '0 15% 96%',
      '--sidebar-accent-foreground': '0 40% 10%',
      '--sidebar-border': '0 15% 90%',
      '--sidebar-ring': '0 72% 51%',
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    gradient: ['#111827', '#6b7280'],
    vars: {
      '--primary': '220 9% 46%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '220 9% 46%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '220 9% 46%',
      '--sidebar-background': '220 12% 8%',
      '--sidebar-foreground': '0 0% 90%',
      '--sidebar-primary': '220 9% 55%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '220 10% 14%',
      '--sidebar-accent-foreground': '0 0% 90%',
      '--sidebar-border': '220 10% 14%',
      '--sidebar-ring': '220 9% 55%',
    },
    lightSidebarVars: {
      '--sidebar-background': '0 0% 100%',
      '--sidebar-foreground': '220 12% 8%',
      '--sidebar-primary': '220 9% 46%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '220 8% 96%',
      '--sidebar-accent-foreground': '220 12% 8%',
      '--sidebar-border': '220 8% 90%',
      '--sidebar-ring': '220 9% 46%',
    },
  },
];

interface ThemeContextValue {
  currentTheme: ThemeId;
  setTheme: (id: ThemeId) => void;
  themes: ThemeDefinition[];
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  darkMode: DarkMode;
  setDarkMode: (mode: DarkMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  currentTheme: 'default',
  setTheme: () => {},
  themes: THEMES,
  sidebarMode: 'dark',
  setSidebarMode: () => {},
  darkMode: 'light',
  setDarkMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => {
    return (localStorage.getItem('incline-theme') as ThemeId) || 'default';
  });
  const [sidebarMode, setSidebarModeState] = useState<SidebarMode>(() => {
    return (localStorage.getItem('incline-sidebar-mode') as SidebarMode) || 'dark';
  });
  const [darkMode, setDarkModeState] = useState<DarkMode>(() => {
    return (localStorage.getItem('incline-dark-mode') as DarkMode) || 'light';
  });

  // Apply dark mode class
  useEffect(() => {
    const root = document.documentElement;
    const applyDark = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    if (darkMode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyDark(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyDark(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyDark(darkMode === 'dark');
    }
    localStorage.setItem('incline-dark-mode', darkMode);
  }, [darkMode]);

  useEffect(() => {
    const theme = THEMES.find((t) => t.id === currentTheme);
    if (!theme) return;

    const root = document.documentElement;

    root.style.setProperty('--theme-grad-from', theme.gradient[0]);
    root.style.setProperty('--theme-grad-to', theme.gradient[1]);

    Object.entries(theme.vars).forEach(([key, value]) => {
      if (!key.startsWith('--sidebar-')) {
        root.style.setProperty(key, value);
      }
    });

    const sidebarVars = sidebarMode === 'light' ? theme.lightSidebarVars : theme.vars;
    Object.entries(sidebarVars).forEach(([key, value]) => {
      if (key.startsWith('--sidebar-')) {
        root.style.setProperty(key, value);
      }
    });

    localStorage.setItem('incline-theme', currentTheme);
    localStorage.setItem('incline-sidebar-mode', sidebarMode);
  }, [currentTheme, sidebarMode]);

  const setSidebarMode = (mode: SidebarMode) => setSidebarModeState(mode);

  const setDarkMode = (mode: DarkMode) => setDarkModeState(mode);

  return (
    <ThemeContext.Provider
      value={{ currentTheme, setTheme: setCurrentTheme, themes: THEMES, sidebarMode, setSidebarMode, darkMode, setDarkMode }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
