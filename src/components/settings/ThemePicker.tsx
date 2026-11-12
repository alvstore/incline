import { useTheme, ThemeId, DarkMode } from '@/contexts/ThemeContext';
import { Check, Sun, Moon, Monitor, PanelLeft, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

const DARK_MODE_OPTIONS: { value: DarkMode; label: string; icon: React.ElementType; desc: string }[] = [
  { value: 'light', label: 'Light', icon: Sun, desc: 'Always light' },
  { value: 'dark', label: 'Dark', icon: Moon, desc: 'Always dark' },
  { value: 'system', label: 'System', icon: Monitor, desc: 'Follows OS' },
];

const SIDEBAR_OPTIONS = [
  { value: 'dark' as const, label: 'Dark', icon: PanelLeft, desc: 'Rich & immersive' },
  { value: 'light' as const, label: 'Light', icon: PanelLeftOpen, desc: 'Clean & minimal' },
];

export function ThemePicker() {
  const { currentTheme, setTheme, themes, sidebarMode, setSidebarMode, darkMode, setDarkMode } = useTheme();
  const active = themes.find((t) => t.id === currentTheme)!;

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start gap-4">
        <div
          className="w-14 h-14 rounded-2xl shadow-lg flex-shrink-0"
          style={{
            background: `linear-gradient(135deg, ${active.gradient[0]}, ${active.gradient[1]})`,
          }}
        />
        <div>
          <h3 className="text-xl font-bold tracking-tight">Appearance</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Personalize the look and feel of your workspace
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted rounded-full px-3 py-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: active.gradient[1] }}
            />
            {active.name} theme · {sidebarMode === 'dark' ? 'Dark' : 'Light'} sidebar · {darkMode.charAt(0).toUpperCase() + darkMode.slice(1)} mode
          </div>
        </div>
      </div>

      {/* Color Theme */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Color Theme</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {themes.map((theme) => {
            const isActive = currentTheme === theme.id;
            return (
              <button
                key={theme.id}
                data-testid={`theme-option-${theme.id}`}
                type="button"
                aria-pressed={isActive}
                onClick={() => setTheme(theme.id as ThemeId)}
                className={cn(
                  'group relative flex flex-col items-center gap-2.5 p-4 rounded-2xl border transition-all duration-200 text-left',
                  isActive
                    ? 'border-transparent ring-2 ring-offset-2 shadow-md scale-[1.03]'
                    : 'border-border hover:border-transparent hover:shadow-md hover:scale-[1.02] bg-card'
                )}
                style={
                  isActive
                    ? { boxShadow: `0 0 0 2px ${theme.gradient[1]}, 0 4px 20px -4px ${theme.gradient[1]}55` }
                    : {}
                }
              >
                {/* Gradient swatch */}
                <div
                  className="w-full h-10 rounded-xl shadow-inner transition-transform duration-200 group-hover:scale-[1.04]"
                  style={{
                    background: `linear-gradient(135deg, ${theme.gradient[0]} 0%, ${theme.gradient[1]} 100%)`,
                  }}
                />

                <span className="text-xs font-semibold">{theme.name}</span>

                {isActive && (
                  <span
                    className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center shadow"
                    style={{ background: theme.gradient[1] }}
                  >
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Mode & Sidebar — side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

        {/* Dark Mode */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Display Mode</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DARK_MODE_OPTIONS.map(({ value, label, icon: Icon, desc }) => {
              const isActive = darkMode === value;
              return (
                <button
                  key={value}
                  data-testid={`dark-mode-${value}`}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setDarkMode(value)}
                  className={cn(
                    'flex flex-col items-center gap-2 py-4 px-2 rounded-xl border transition-all duration-200',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground shadow-md'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-muted/50'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <div className="text-center">
                    <div className="text-xs font-semibold">{label}</div>
                    <div className={cn('text-[10px] mt-0.5', isActive ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Sidebar Style */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sidebar Style</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SIDEBAR_OPTIONS.map(({ value, label, icon: Icon, desc }) => {
              const isActive = sidebarMode === value;
              return (
                <button
                  key={value}
                  data-testid={`sidebar-mode-${value}`}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSidebarMode(value)}
                  className={cn(
                    'flex flex-col items-center gap-2 py-5 px-3 rounded-xl border transition-all duration-200',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground shadow-md'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-muted/50'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <div className="text-center">
                    <div className="text-xs font-semibold">{label}</div>
                    <div className={cn('text-[10px] mt-0.5', isActive ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {/* Live Preview Card */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Preview</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="rounded-2xl border bg-card overflow-hidden shadow-sm">
          {/* Mini sidebar */}
          <div className="flex h-28">
            <div
              className="w-36 flex flex-col justify-between p-3"
              style={{
                background:
                  sidebarMode === 'dark'
                    ? `linear-gradient(160deg, ${active.gradient[0]}, ${active.gradient[0]}dd)`
                    : 'white',
                borderRight: '1px solid rgba(0,0,0,0.07)',
              }}
            >
              <div className="space-y-1.5">
                {['Dashboard', 'Members', 'Classes'].map((item, i) => (
                  <div
                    key={item}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                    style={
                      i === 0
                        ? {
                            background: active.gradient[1],
                            color: 'white',
                          }
                        : {
                            color: sidebarMode === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)',
                          }
                    }
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: i === 0 ? 'white' : 'currentColor', opacity: i === 0 ? 1 : 0.5 }}
                    />
                    <span className="text-[10px] font-medium">{item}</span>
                  </div>
                ))}
              </div>
              <div
                className="flex items-center gap-1.5 px-2"
                style={{ color: sidebarMode === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)' }}
              >
                <div className="w-4 h-4 rounded-full bg-current opacity-60" />
                <span className="text-[9px] font-medium truncate">Admin User</span>
              </div>
            </div>
            {/* Mini content */}
            <div className="flex-1 p-3 space-y-2 bg-background">
              <div className="flex gap-2">
                {[active.gradient[1], '#e5e7eb', '#e5e7eb'].map((bg, i) => (
                  <div
                    key={i}
                    className="flex-1 h-8 rounded-lg"
                    style={{ background: i === 0 ? bg : undefined, backgroundColor: i !== 0 ? bg : undefined, opacity: i === 0 ? 0.9 : 1 }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-muted/60" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
