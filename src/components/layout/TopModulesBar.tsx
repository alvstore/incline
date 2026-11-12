import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ModuleGroup } from '@/config/navModules';

interface TopModulesBarProps {
  groups: ModuleGroup[];
  activeModuleId?: string;
  onSelect?: (moduleId: string) => void;
  /** When true, the bar renders without its own border/background (parent owns chrome). */
  bare?: boolean;
}

export function TopModulesBar({ groups, activeModuleId, onSelect, bare = false }: TopModulesBarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  if (groups.length === 0) return null;

  const isItemActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(href + '/');

  const handleModuleClick = (g: ModuleGroup) => {
    onSelect?.(g.module.id);
    const first = g.items[0];
    if (first && location.pathname !== first.href) {
      navigate(first.href);
    }
  };

  return (
    <div
      className={cn(
        'hidden lg:block w-full',
        !bare && 'border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70',
      )}
    >
      <ScrollArea className="w-full">
        <nav className={cn('flex items-center gap-1', bare ? 'px-2 py-2 justify-center' : 'px-4 py-2')}>
          {groups.map((g) => {
            const Icon = g.module.icon;
            const isActive = g.module.id === activeModuleId;
            const hasChildren = g.items.length > 1;

            const trigger = (
              <button aria-current={isActive ? 'page' : undefined}
                type="button"
                onClick={() => handleModuleClick(g)}
                data-testid={`top-module-${g.module.id}`}
                className={cn(
                  'relative inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition-all duration-200 whitespace-nowrap',
                  isActive
                    ? 'bg-primary/10 text-primary shadow-[0_6px_20px_-10px_hsl(var(--primary)/0.55)]'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{g.module.label}</span>
                {hasChildren && <ChevronDown className="h-3.5 w-3.5 opacity-70" />}
                {isActive && (
                  <span className="pointer-events-none absolute left-3 right-3 -bottom-[7px] h-[2px] rounded-full bg-primary" />
                )}
              </button>
            );

            if (!hasChildren) {
              return <div key={g.module.id}>{trigger}</div>;
            }

            return (
              <DropdownMenu key={g.module.id}>
                <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <span>{g.module.label}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {g.items.map((item) => {
                    const ItemIcon = item.icon;
                    const active = isItemActive(item.href);
                    return (
                      <DropdownMenuItem
                        key={item.href}
                        asChild
                        className={cn('cursor-pointer', active && 'bg-primary/10 text-primary')}
                      >
                        <Link to={item.href} className="flex items-center gap-2">
                          <ItemIcon className="h-4 w-4" />
                          <span className="flex-1 truncate">{item.label}</span>
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </nav>
        <ScrollBar orientation="horizontal" className="invisible" />
      </ScrollArea>
    </div>
  );
}

export { Link };
