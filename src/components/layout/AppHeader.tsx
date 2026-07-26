import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranchContext } from '@/contexts/BranchContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BranchSelector } from '@/components/dashboard/BranchSelector';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Settings, 
  User, 
  LogOut, 
  Moon, 
  Sun,
  MapPin,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGlobalChatSound } from '@/hooks/useChatSound';
import { NavModeMenu } from './NavModeMenu';
import { AppearanceMenu } from './AppearanceMenu';

function mapRoleLabel(role: string): string {
  return role === 'owner' ? 'Admin' : role;
}

export interface AppHeaderProps {
  /** 'standalone' (default) draws own border + sticky shell. 'hybrid' is bare — the parent grid owns chrome. */
  variant?: 'standalone' | 'hybrid';
  /** Render brand/logo on the left. Only true when there is no sidebar (horizontal-stacked mode). */
  showBrand?: boolean;
}

export function AppHeader({ variant = 'standalone', showBrand = false }: AppHeaderProps) {
  const { profile, signOut, roles, user, hasAnyRole } = useAuth();
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'));

  // Global realtime ping for inbound WhatsApp messages — works on any page.
  useGlobalChatSound(!!user?.id);

  const { selectedBranch, setSelectedBranch, branches, showSelector, showAllOption, currentBranchName } = useBranchContext();

  const getInitials = (name: string | null) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const toggleTheme = () => {
    document.documentElement.classList.toggle('dark');
    setIsDark(!isDark);
  };

  const primaryRole = roles[0];
  const primaryRoleString = typeof primaryRole === 'string' ? primaryRole : primaryRole?.role || 'user';
  const isMember = roles.some(r => (typeof r === 'string' ? r : r?.role) === 'member');
  const isAdmin = hasAnyRole(['owner', 'admin']);
  const showBranchBadge = !showSelector && currentBranchName && currentBranchName !== 'All Branches';

  // Fetch member code if user is a member
  const { data: memberCode } = useQuery({
    queryKey: ['user-member-code', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('members')
        .select('member_code')
        .eq('user_id', user.id)
        .single();
      return data?.member_code;
    },
    enabled: !!user?.id && isMember,
  });

  const handleProfileClick = () => {
    if (isMember) {
      navigate('/member-profile');
    } else {
      navigate('/profile');
    }
  };

  // Org branding for the standalone (Header + Horizontal stacked) variant
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
    enabled: variant === 'standalone' && showBrand,
  });

  return (
    <header
      className={
        variant === 'hybrid'
          ? 'hidden lg:flex h-14 items-center justify-between px-4 w-full'
          : 'hidden lg:flex h-16 items-center gap-4 px-6 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40'
      }
    >
      {/* Brand / logo (only when no sidebar is shown) */}
      {variant === 'standalone' && showBrand && (
        <div className="shrink-0 flex items-center">
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
      )}

      {/* Search — centered when brand is on the left, otherwise left-aligned */}
      <div
        className={
          showBrand
            ? 'flex-1 flex items-center justify-center gap-3 min-w-0'
            : 'flex-1 flex items-center justify-start gap-3 min-w-0'
        }
      >
        {!isMember && (
          <div className="w-full max-w-md">
            <GlobalSearch />
          </div>
        )}
        {/* Branch badge for non-selector roles */}
        {showBranchBadge && (
          <Badge variant="secondary" className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium whitespace-nowrap">
            <MapPin className="h-3 w-3" />
            {currentBranchName}
          </Badge>
        )}
      </div>

      {/* Right Side Actions */}
      <div className="flex items-center gap-2">
        {/* Global Branch Selector - RBAC controlled */}
        {showSelector && branches.length > 0 && (
          <BranchSelector
            branches={branches}
            selectedBranch={selectedBranch}
            onBranchChange={setSelectedBranch}
            showAllOption={showAllOption}
          />
        )}

        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="rounded-full hover:bg-muted"
        >
          {isDark ? (
            <Sun className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
          ) : (
            <Moon className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
          )}
        </Button>

        {/* Appearance / color picker */}
        <AppearanceMenu />

        {/* Navigation layout switcher */}
        <NavModeMenu />

        {/* Notifications */}
        <NotificationBell />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-10 w-10 rounded-full">
              <Avatar className="h-10 w-10 border-2 border-transparent hover:border-accent transition-colors">
                <AvatarImage src={profile?.avatar_url ? `${profile.avatar_url}${profile.avatar_url.includes('?') ? '&' : '?'}v=${encodeURIComponent(String((profile as any).updated_at ?? Date.now()))}` : undefined} />
                <AvatarFallback className="bg-accent text-accent-foreground font-semibold">
                  {getInitials(profile?.full_name)}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium leading-none">{profile?.full_name || 'User'}</p>
                  <Badge variant="outline" className="text-xs capitalize">
                    {mapRoleLabel(primaryRoleString)}
                  </Badge>
                </div>
                {memberCode && (
                  <p className="text-xs font-mono text-primary font-semibold">{memberCode}</p>
                )}
                <p className="text-xs leading-none text-muted-foreground">{profile?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleProfileClick} className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              <span>Profile</span>
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="cursor-pointer text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
