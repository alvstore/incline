import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { getNavMode, subscribeNavMode, type NavMode } from '@/lib/navPreferences';
import { useAuth } from '@/contexts/AuthContext';
import { Building2, Plug, Bell, Shield, Settings as SettingsIcon, Gift, Sparkles, MessageSquare, Receipt, Palette, Bot, IndianRupee, Database, ScanLine, Zap, UserCircle } from 'lucide-react';
import { AutomationsControlRoom } from '@/components/settings/AutomationsControlRoom';
import { HowbodySettings } from '@/components/settings/HowbodySettings';
import { BackupRestore } from '@/components/settings/BackupRestore';
import { OrganizationSettings } from '@/components/settings/OrganizationSettings';
import { BranchSettings } from '@/components/settings/BranchSettings';
import { IntegrationSettings } from '@/components/settings/IntegrationSettings';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { SecuritySettings } from '@/components/settings/SecuritySettings';
import { ReferralSettings } from '@/components/settings/ReferralSettings';
import { BenefitSettingsComponent } from '@/components/settings/BenefitSettingsComponent';
import { CommunicationTemplatesHub } from '@/components/settings/CommunicationTemplatesHub';
import { FinanceCategoryManager } from '@/components/settings/FinanceCategoryManager';
import { ThemePicker } from '@/components/settings/ThemePicker';
import { AIAgentControlCenter } from '@/components/settings/AIAgentControlCenter';
import { TaxGstSettings } from '@/components/settings/TaxGstSettings';

const SETTINGS_MENU = [
  { value: 'ai-agent', label: 'AI Agent', icon: Bot },
  { value: 'automations', label: 'Automation Brain', icon: Zap },
  { value: 'appearance', label: 'Appearance', icon: Palette },
  { value: 'backup', label: 'Disaster Recovery', icon: Database },
  { value: 'benefits', label: 'Benefits', icon: Sparkles },
  { value: 'howbody', label: 'Body Scanner', icon: ScanLine },
  { value: 'branches', label: 'Branches', icon: Building2 },
  { value: 'finance-categories', label: 'Finance Categories', icon: Receipt },
  { value: 'integrations', label: 'Integrations', icon: Plug },
  { value: 'notifications', label: 'Notifications', icon: Bell },
  { value: 'organization', label: 'Organization', icon: SettingsIcon },
  { value: 'referrals', label: 'Referrals', icon: Gift },
  { value: 'security', label: 'Security', icon: Shield },
  { value: 'tax-gst', label: 'Tax & GST', icon: IndianRupee },
  { value: 'templates', label: 'Communication Templates', icon: MessageSquare },
];

const SETTINGS_CONTENT: Record<string, React.ReactNode> = {
  organization: <OrganizationSettings />,
  branches: <BranchSettings />,
  appearance: <ThemePicker />,
  'ai-agent': <AIAgentControlCenter />,
  automations: <AutomationsControlRoom />,
  benefits: <BenefitSettingsComponent />,
  referrals: <ReferralSettings />,
  templates: <CommunicationTemplatesHub />,
  'finance-categories': <FinanceCategoryManager />,
  'tax-gst': <TaxGstSettings />,
  integrations: <IntegrationSettings />,
  notifications: <NotificationSettings />,
  security: <SecuritySettings />,
  backup: <BackupRestore />,
  howbody: <HowbodySettings />,
};

const PERSONAL_TABS = new Set(['appearance', 'notifications']);
const ADMIN_ROLES = new Set(['owner', 'admin', 'manager']);

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [navMode, setNavModeState] = useState<NavMode>(getNavMode);
  const { roles } = useAuth();

  useEffect(() => subscribeNavMode(setNavModeState), []);

  const isAdminLike = useMemo(
    () => roles.some((r) => ADMIN_ROLES.has(r.role)),
    [roles]
  );

  const visibleMenu = useMemo(
    () => (isAdminLike ? SETTINGS_MENU : SETTINGS_MENU.filter((m) => PERSONAL_TABS.has(m.value))),
    [isAdminLike]
  );

  const defaultTab = isAdminLike ? 'organization' : 'appearance';
  const requestedTab = searchParams.get('tab') || defaultTab;
  if (requestedTab === 'retention') return <Navigate to="/announcements?tab=retention" replace />;
  // Out-of-scope tabs for non-admin → bounce to default
  const activeTab = visibleMenu.some((m) => m.value === requestedTab) ? requestedTab : defaultTab;

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  const isHorizontalStacked = navMode === 'horizontal-stacked';

  const Header = (
    <div className="flex items-center gap-3">
      <SettingsIcon className="h-8 w-8 text-primary" />
      <div>
        <h1 className="text-2xl font-bold">{isAdminLike ? 'Settings' : 'Preferences'}</h1>
        <p className="text-muted-foreground">
          {isAdminLike ? 'Manage your organization settings' : 'Personalize your experience'}
        </p>
      </div>
    </div>
  );

  const content = SETTINGS_CONTENT[activeTab] || (isAdminLike ? <OrganizationSettings /> : <ThemePicker />);

  if (isHorizontalStacked) {
    return (
      <AppLayout>
        <div className="space-y-6">
          {/* Horizontal sub-nav matching TopModulesBar style */}
          <div className="rounded-2xl bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70 shadow-sm">
            <ScrollArea className="w-full">
              <nav className="flex items-center gap-1 px-2 py-2 lg:justify-center">
                {visibleMenu.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => handleTabChange(item.value)}
                      className={cn(
                        'relative inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition-all duration-200 whitespace-nowrap',
                        isActive
                          ? 'bg-primary/10 text-primary shadow-[0_6px_20px_-10px_hsl(var(--primary)/0.55)]'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                      {isActive && (
                        <span className="pointer-events-none absolute left-3 right-3 -bottom-[7px] h-[2px] rounded-full bg-primary" />
                      )}
                    </button>
                  );
                })}
              </nav>
              <ScrollBar orientation="horizontal" className="invisible" />
            </ScrollArea>
          </div>

          {Header}

          <div className="min-w-0">{content}</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {Header}

        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar Navigation */}
          <nav className="w-full md:w-60 shrink-0">
            <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
              {visibleMenu.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => handleTabChange(item.value)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
                      'hover:bg-muted/80',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Content Area */}
          <div className="flex-1 min-w-0">{content}</div>
        </div>
      </div>
    </AppLayout>
  );
}