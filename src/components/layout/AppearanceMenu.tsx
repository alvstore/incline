import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Palette, Check, Sun, Moon, Monitor, PanelLeft, PanelLeftOpen, Settings as SettingsIcon } from 'lucide-react';
import { useTheme, type ThemeId, type DarkMode, type SidebarMode } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

const DARK_OPTIONS: Array<{ value: DarkMode; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
];

const SIDEBAR_OPTIONS: Array<{ value: SidebarMode; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'dark', label: 'Dark', icon: PanelLeft },
  { value: 'light', label: 'Light', icon: PanelLeftOpen },
];

export function AppearanceMenu() {
  const { currentTheme, setTheme, themes, darkMode, setDarkMode, sidebarMode, setSidebarMode } = useTheme();
  const active = themes.find((t) => t.id === currentTheme)!;

  return (
    <TooltipProvider delayDuration={200}>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Appearance"
                data-testid="button-appearance"
                className="h-9 w-9 relative"
              >
                <Palette className="h-4 w-4" />
                <span
                  className="absolute bottom-1 right-1 w-2 h-2 rounded-full ring-2 ring-background"
                  style={{ background: active.gradient[1] }}
                />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Appearance</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="end" className="w-72 p-3">
          <DropdownMenuLabel className="px-1 pb-2 flex items-center justify-between">
            <span>Appearance</span>
            <span className="text-[10px] font-normal text-muted-foreground">{active.name}</span>
          </DropdownMenuLabel>

          {/* Color themes */}
          <div className="px-1 pb-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Color theme
            </div>
            <div className="grid grid-cols-5 gap-2">
              {themes.map((t) => {
                const isActive = currentTheme === t.id;
                return (
                  <button aria-pressed={isActive} type="button"
                    key={t.id}
                    onClick={() => setTheme(t.id as ThemeId)}
                    title={t.name}
                    aria-label={t.name}
                    data-testid={`appearance-theme-${t.id}`}
                    className={cn(
                      'relative h-8 w-full rounded-lg transition-all duration-150 hover:scale-105',
                      isActive ? 'ring-2 ring-offset-2 ring-offset-background' : 'ring-1 ring-border'
                    )}
                    style={{
                      background: `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})`,
                      // @ts-expect-error CSS var
                      '--tw-ring-color': t.gradient[1],
                    }}
                  >
                    {isActive && (
                      <Check className="h-3.5 w-3.5 text-white absolute inset-0 m-auto drop-shadow" strokeWidth={3} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <DropdownMenuSeparator />

          {/* Display mode */}
          <div className="px-1 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Display mode
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {DARK_OPTIONS.map(({ value, label, icon: Icon }) => {
                const isActive = darkMode === value;
                return (
                  <button aria-pressed={isActive} type="button"
                    key={value}
                    onClick={() => setDarkMode(value)}
                    data-testid={`appearance-dark-${value}`}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2 rounded-lg border transition-all',
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:bg-muted'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <DropdownMenuSeparator />

          {/* Sidebar style */}
          <div className="px-1 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Sidebar style
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {SIDEBAR_OPTIONS.map(({ value, label, icon: Icon }) => {
                const isActive = sidebarMode === value;
                return (
                  <button aria-pressed={isActive} type="button"
                    key={value}
                    onClick={() => setSidebarMode(value)}
                    data-testid={`appearance-sidebar-${value}`}
                    className={cn(
                      'flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-all',
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:bg-muted'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <DropdownMenuSeparator />

          <Link
            to="/settings?tab=appearance"
            className="flex items-center gap-2 px-2 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            More appearance settings
          </Link>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
