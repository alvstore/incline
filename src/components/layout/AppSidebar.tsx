import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getMenuForRole } from '@/config/menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Menu, LogOut, ChevronLeft, ChevronRight, Dumbbell } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

function useOrgBranding() {
  return useQuery({
    queryKey: ['org-branding'],
    queryFn: async () => {
      const { data } = await supabase
        .from('organization_settings')
        .select('logo_url, name')
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useWhatsAppUnreadCount() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('sidebar-unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_chat_settings' }, () => {
        queryClient.invalidateQueries({ queryKey: ['whatsapp-unread-count'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return useQuery({
    queryKey: ['whatsapp-unread-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('whatsapp_chat_settings')
        .select('id', { count: 'exact', head: true })
        .eq('is_unread', true);
      if (error) return 0;
      return count ?? 0;
    },
    staleTime: 30 * 1000,
    refetchInterval: 30000,
  });
}

function BrandLogo({ collapsed = false, mobile = false }: { collapsed?: boolean; mobile?: boolean }) {
  const { data: org } = useOrgBranding();
  const logoContainerClass = cn('flex items-center', mobile ? 'h-16 max-w-[220px]' : 'h-14 max-w-[190px]');
  
  if (org?.logo_url) {
    if (collapsed) {
      return <img src={org.logo_url} alt={org.name || 'Logo'} className="h-9 w-9 object-contain rounded-md" />;
    }
    return (
      <div className={logoContainerClass}>
        <img
          src={org.logo_url}
          alt={org.name || 'Logo'}
          className="h-full w-full object-contain object-left"
        />
      </div>
    );
  }
  
  const displayName = org?.name && org.name !== 'Default' ? org.name : 'Incline';
  
  if (collapsed) {
    return (
      <div className="p-2 rounded-lg bg-[hsl(var(--primary))]/10">
        <Dumbbell className="h-5 w-5 text-[hsl(var(--primary))]" />
      </div>
    );
  }
  
  return (
    <div className={cn('rounded-xl border border-sidebar-border/70 bg-sidebar-accent/25 px-3', logoContainerClass)}>
      <div className={cn('rounded-lg bg-[hsl(var(--primary))]/10', mobile ? 'p-2' : 'p-1.5')}>
        <Dumbbell className={cn(mobile ? 'h-6 w-6' : 'h-5 w-5', 'text-[hsl(var(--primary))]')} />
      </div>
      <div className="flex flex-col">
        <span className={cn('text-sidebar-primary font-bold leading-tight tracking-tight', mobile ? 'text-lg' : 'text-base')}>
          {displayName}
        </span>
        <span className="text-[10px] text-sidebar-foreground/40 font-medium uppercase tracking-widest leading-none">
          Fitness
        </span>
      </div>
    </div>
  );
}

import type { MenuItem as MenuItemType } from '@/config/menu';
import type { NavMode } from '@/lib/navPreferences';

interface AppSidebarProps {
  /** New navigation mode. Falls back to legacy `collapsed` prop when omitted. */
  mode?: NavMode;
  /** Legacy boolean prop — kept for back-compat. */
  collapsed?: boolean;
  onToggleCollapse: () => void;
  /** Items to show in hybrid mode (already RBAC-filtered, scoped to active module). */
  hybridItems?: MenuItemType[];
  /** Active module label shown above the items in hybrid mode. */
  hybridModuleLabel?: string;
  /** When true, do not render the sidebar's own header block (logo / module chip / collapse). */
  headerless?: boolean;
  /** When true, the aside doesn't manage its own height/sticky — parent grid does. */
  embedded?: boolean;
}

export function AppSidebar({
  mode,
  collapsed: collapsedProp,
  onToggleCollapse,
  hybridItems,
  hybridModuleLabel,
  headerless = false,
  embedded = false,
}: AppSidebarProps) {
  const { signOut, roles } = useAuth();
  const location = useLocation();
  const { data: unreadCount = 0 } = useWhatsAppUnreadCount();

  const resolvedMode: NavMode = mode ?? (collapsedProp ? 'collapsed' : 'vertical');
  const collapsed = resolvedMode === 'collapsed';
  const isHybrid = resolvedMode === 'hybrid';

  const userRoleSet = new Set(roles.map(r => r.role));
  const { hasPt } = useMemberHasPtPackage();
  const passesRequires = (item: { requires?: string }) =>
    !item.requires || (item.requires === 'has_pt_package' ? hasPt : true);
  const fullSections = getMenuForRole(roles)
    .map(section => ({
      ...section,
      items: section.items.filter(item => item.roles.some(r => userRoleSet.has(r)) && passesRequires(item)),
    }))
    .filter(section => section.items.length > 0);

  const menuSections = isHybrid
    ? [{ title: hybridModuleLabel ?? '', items: hybridItems ?? [] }].filter(s => s.items.length > 0)
    : fullSections;

  const renderUnreadBadge = (href: string) => {
    if (href !== '/whatsapp-chat' || unreadCount === 0) return null;
    return (
      <span className="bg-red-500 text-white rounded-full text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1">
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200',
          embedded ? 'h-full' : 'h-screen sticky top-0 shadow-sm',
          collapsed ? 'w-14' : 'w-64'
        )}
      >
        {!headerless && (
          <div className={cn(
            'border-b border-sidebar-border flex items-center',
            collapsed ? 'p-3 justify-center' : 'p-5 justify-between'
          )}>
            <BrandLogo collapsed={collapsed} />
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapse}
                data-testid="button-sidebar-toggle"
                aria-label="Collapse sidebar"
                className="h-8 w-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            {collapsed && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapse}
                data-testid="button-sidebar-toggle"
                aria-label="Expand sidebar"
                className="h-8 w-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute -right-3 top-5 bg-sidebar border border-sidebar-border rounded-full shadow-sm z-10"
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        <ScrollArea className="flex-1 py-4">
          <nav className={cn('space-y-6', collapsed ? 'px-1' : 'px-3')}>
            {menuSections.map((section) => (
              <div key={section.title}>
                {!collapsed && !isHybrid && section.title && (
                  <p className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                    {section.title}
                  </p>
                )}
                <ul className="space-y-1">
                  {section.items.map((item) => {
                    const isActive =
                      location.pathname === item.href ||
                      (item.href === '/fitness/create' &&
                        (location.pathname.startsWith('/fitness/') ||
                          location.pathname === '/meal-catalog'));
                    if (collapsed) {
                      return (
                        <li key={item.href}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link
                                to={item.href}
                                data-testid={`link-nav-${item.href.replace(/\//g, '-')}`}
                                className={cn(
                                  'flex items-center justify-center p-2 rounded-lg transition-colors relative',
                                  isActive
                                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                                )}
                              >
                                <item.icon className="h-4 w-4" />
                                {item.href === '/whatsapp-chat' && unreadCount > 0 && (
                                  <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-[9px] font-bold min-w-[16px] h-[16px] flex items-center justify-center px-0.5">
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                  </span>
                                )}
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              {item.label}
                            </TooltipContent>
                          </Tooltip>
                        </li>
                      );
                    }
                    return (
                      <li key={item.href}>
                        <Link
                          to={item.href}
                          data-testid={`link-nav-${item.href.replace(/\//g, '-')}`}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          <span className="flex-1">{item.label}</span>
                          {renderUnreadBadge(item.href)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </ScrollArea>

        <div className={cn('border-t border-sidebar-border', collapsed ? 'p-2' : 'p-4')}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={signOut}
                  data-testid="button-sign-out"
                  aria-label="Sign Out"
                  className="w-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign Out</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              onClick={signOut}
              data-testid="button-sign-out"
              className="w-full justify-start text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4 mr-3" />
              Sign Out
            </Button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { signOut, roles } = useAuth();
  const location = useLocation();
  const { data: unreadCount = 0 } = useWhatsAppUnreadCount();

  const userRoleSet = new Set(roles.map(r => r.role));
  const { hasPt } = useMemberHasPtPackage();
  const passesRequires = (item: { requires?: string }) =>
    !item.requires || (item.requires === 'has_pt_package' ? hasPt : true);
  const menuSections = getMenuForRole(roles)
    .map(section => ({
      ...section,
      items: section.items.filter(item => item.roles.some(r => userRoleSet.has(r)) && passesRequires(item)),
    }))
    .filter(section => section.items.length > 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0 bg-sidebar">
        <div className="px-5 py-4 border-b border-sidebar-border">
          <BrandLogo mobile />
        </div>

        <ScrollArea className="h-[calc(100vh-180px)] py-4">
          <nav className="px-3 space-y-6">
            {menuSections.map((section) => (
              <div key={section.title}>
                <p className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  {section.title}
                </p>
                <ul className="space-y-1">
                  {section.items.map((item) => {
                    const isActive =
                      location.pathname === item.href ||
                      (item.href === '/fitness/create' &&
                        (location.pathname.startsWith('/fitness/') ||
                          location.pathname === '/meal-catalog'));
                    return (
                      <li key={item.href}>
                        <Link
                          to={item.href}
                          onClick={() => setOpen(false)}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          <span className="flex-1">{item.label}</span>
                          {item.href === '/whatsapp-chat' && unreadCount > 0 && (
                            <span className="bg-red-500 text-white rounded-full text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1">
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </ScrollArea>

        <div className="p-4 border-t border-sidebar-border">
          <Button
            variant="ghost"
            onClick={() => { signOut(); setOpen(false); }}
            className="w-full justify-start text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4 mr-3" />
            Sign Out
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
