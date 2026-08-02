import { ReactNode, useState, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSidebar, MobileNav } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { TopModulesBar } from './TopModulesBar';
import { useAuth } from '@/contexts/AuthContext';
import { useBranchContext } from '@/contexts/BranchContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { useOrgBranding } from '@/hooks/useOrgBranding';
import { supabase } from '@/integrations/supabase/client';
import { SessionTimeoutWarning } from '@/components/auth/SessionTimeoutWarning';
import { AlertTriangle, RefreshCw, Building2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getNavMode, setNavMode, subscribeNavMode, type NavMode } from '@/lib/navPreferences';
import { getMenuForRole } from '@/config/menu';
import { groupMenuIntoModules, findActiveModuleId } from '@/config/navModules';
import { usePresenceHeartbeat } from '@/hooks/usePresence';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { profile, roles } = useAuth();
  const { branchStatus, retryBranchFetch } = useBranchContext();
  const location = useLocation();

  // Live presence heartbeat (mounted once globally)
  usePresenceHeartbeat();

  const [navMode, setNavModeState] = useState<NavMode>(getNavMode);
  useEffect(() => subscribeNavMode(setNavModeState), []);

  const handleToggleCollapse = useCallback(() => {
    const next: NavMode = navMode === 'collapsed' ? 'vertical' : 'collapsed';
    setNavMode(next);
  }, [navMode]);

  // Build module groups from the existing role-aware menu (RBAC preserved upstream).
  const moduleGroups = useMemo(() => {
    const userRoleSet = new Set(roles.map((r) => r.role));
    const filtered = getMenuForRole(roles)
      .map((s) => ({ ...s, items: s.items.filter((i) => i.roles.some((r) => userRoleSet.has(r))) }))
      .filter((s) => s.items.length > 0);
    return groupMenuIntoModules(filtered);
  }, [roles]);

  const routeModuleId = useMemo(
    () => findActiveModuleId(moduleGroups, location.pathname),
    [moduleGroups, location.pathname],
  );

  const [activeModuleId, setActiveModuleId] = useState<string | undefined>(routeModuleId);
  useEffect(() => { setActiveModuleId(routeModuleId); }, [routeModuleId]);

  const activeItems = useMemo(
    () => moduleGroups.find((g) => g.module.id === activeModuleId)?.items ?? [],
    [moduleGroups, activeModuleId],
  );
  const activeModuleLabel = useMemo(
    () => moduleGroups.find((g) => g.module.id === activeModuleId)?.module.label,
    [moduleGroups, activeModuleId],
  );

  const { data: org } = useQuery({
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

  const getInitials = (name: string | null) => {
    if (!name) return 'U';
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const renderContent = () => {
    if (branchStatus === 'loading') {
      return (
        <div className="space-y-6 p-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      );
    }

    if (branchStatus === 'no_branch_assigned') {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center">
              <Building2 className="h-8 w-8 text-warning" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">No Branch Assigned</h2>
              <p className="text-muted-foreground mt-2">
                Your account hasn't been assigned to a branch yet. Please contact your administrator to get branch access.
              </p>
            </div>
            <Button variant="outline" onClick={retryBranchFetch} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        </div>
      );
    }

    if (branchStatus === 'error') {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Unable to Load Branch Data</h2>
              <p className="text-muted-foreground mt-2">
                There was an error loading your branch information. Please try again.
              </p>
            </div>
            <Button onClick={retryBranchFetch} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        </div>
      );
    }

    return (
      <main className="flex-1 overflow-auto overflow-x-hidden p-6">
        {children}
      </main>
    );
  };

  // ===== Horizontal (hybrid) mode: top bar only, NO sidebar (desktop) =====
  if (navMode === 'hybrid') {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        {/* Mobile header (unchanged) */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-card">
          <MobileNav />
          <h1 className="text-xl font-bold">
            {org?.logo_url ? (
              <img src={org.logo_url} alt={org.name || 'Logo'} className="max-h-7 object-contain" />
            ) : (
              <span className="text-accent">{org?.name || 'Incline'}</span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Avatar className="h-8 w-8">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback className="bg-accent text-accent-foreground text-xs">
                {getInitials(profile?.full_name)}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Desktop: single horizontal band — brand + modules + header utilities */}
        <div className="hidden lg:flex sticky top-0 z-40 h-14 items-center bg-card border-b border-border">
          <div className="shrink-0 flex items-center pl-5 pr-4">
            {org?.logo_url ? (
              <img
                src={org.logo_url}
                alt={org.name || 'Logo'}
                className="max-h-8 object-contain object-left"
              />
            ) : (
              <span className="text-lg font-bold text-foreground">
                {org?.name && org.name !== 'Default' ? org.name : 'Incline'}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0 flex items-center">
            <TopModulesBar
              groups={moduleGroups}
              activeModuleId={activeModuleId}
              onSelect={setActiveModuleId}
              bare
            />
          </div>
          <div className="shrink-0">
            <AppHeader variant="hybrid" />
          </div>
        </div>

        {/* Full-width content (no sidebar) */}
        <div className="flex flex-1 flex-col min-w-0">
          {renderContent()}
        </div>

        <SessionTimeoutWarning />
      </div>
    );
  }

  // ===== Header + Horizontal stacked mode: full AppHeader on top, modules band below, no sidebar =====
  if (navMode === 'horizontal-stacked') {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        {/* Mobile header (unchanged) */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-card">
          <MobileNav />
          <h1 className="text-xl font-bold">
            {org?.logo_url ? (
              <img src={org.logo_url} alt={org.name || 'Logo'} className="max-h-7 object-contain" />
            ) : (
              <span className="text-accent">{org?.name || 'Incline'}</span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Avatar className="h-8 w-8">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback className="bg-accent text-accent-foreground text-xs">
                {getInitials(profile?.full_name)}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Desktop: full AppHeader on top (with brand, since no sidebar) */}
        <div className="hidden lg:block">
          <AppHeader showBrand />
        </div>

        {/* Desktop: horizontal modules band directly under header (centered) */}
        <div className="hidden lg:block sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70">
          <div className="mx-auto max-w-7xl flex justify-center px-4">
            <TopModulesBar
              groups={moduleGroups}
              activeModuleId={activeModuleId}
              onSelect={setActiveModuleId}
              bare
            />
          </div>
        </div>

        {/* Full-width content (no sidebar) */}
        <div className="flex flex-1 flex-col min-w-0">
          {renderContent()}
        </div>

        <SessionTimeoutWarning />
      </div>
    );
  }

  // ===== Standard layout (vertical / collapsed) =====
  return (
    <div className="min-h-screen flex bg-background">
      <AppSidebar
        mode={navMode}
        onToggleCollapse={handleToggleCollapse}
        hybridItems={activeItems}
        hybridModuleLabel={activeModuleLabel}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop header */}
        <AppHeader />

        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-card">
          <MobileNav />
          <h1 className="text-xl font-bold">
            {org?.logo_url ? (
              <img src={org.logo_url} alt={org.name || 'Logo'} className="max-h-7 object-contain" />
            ) : (
              <span className="text-accent">{org?.name || 'Incline'}</span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Avatar className="h-8 w-8">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback className="bg-accent text-accent-foreground text-xs">
                {getInitials(profile?.full_name)}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        {renderContent()}
      </div>

      <SessionTimeoutWarning />
    </div>
  );
}

