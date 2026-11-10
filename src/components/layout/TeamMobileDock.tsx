import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  DoorOpen, LayoutDashboard, ListChecks, Menu, Plus, ReceiptIndianRupee,
  ScanLine, ShoppingCart, UserPlus, Users, Wallet, X, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { openMobileMenu } from '@/components/layout/AppSidebar';
import { can } from '@/lib/auth/permissions';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';

interface DockItem { label: string; href: string; icon: LucideIcon }
interface QuickAction { label: string; hint: string; href: string; icon: LucideIcon }

/**
 * Floating phone dock for owner/admin/manager/staff (Halvi-style island + centre "+").
 * Tabs adapt to role: financial tab only for roles with view_financials; staff land on their desk home.
 */
export function TeamMobileDock() {
  const { roles } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);

  const roleSet = new Set(roles.map((r) => r.role));
  const isStaffOnly = roleSet.has('staff') && !['owner', 'admin', 'manager'].some((r) => roleSet.has(r as never));
  const financial = can.viewFinancials(roles);
  const gateAdmin = roleSet.has('owner') || roleSet.has('admin');

  const left: DockItem[] = [
    { label: 'Overview', href: isStaffOnly ? '/staff-dashboard' : '/dashboard', icon: LayoutDashboard },
    { label: 'Members', href: '/members', icon: Users },
  ];
  const right: DockItem[] = [
    financial
      ? { label: 'Finance', href: '/finance', icon: Wallet }
      : { label: 'POS', href: '/pos', icon: ShoppingCart },
    { label: 'Tasks', href: '/tasks', icon: ListChecks },
  ];

  const actions: QuickAction[] = [
    { label: 'Gate check-in', hint: 'Live entries & attendance', href: '/attendance-dashboard', icon: ScanLine },
    { label: 'Quick sale', hint: 'Open the desk POS', href: '/pos', icon: ReceiptIndianRupee },
    { label: 'Walk-in lead', hint: 'Capture a new enquiry', href: '/leads', icon: UserPlus },
    { label: 'New task', hint: 'Assign a follow-up', href: '/tasks', icon: ListChecks },
    ...(gateAdmin ? [{ label: 'Gate devices', hint: 'Remote open & status', href: '/devices', icon: DoorOpen }] : []),
  ];

  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 32 };

  const renderTab = ({ label, href, icon: Icon }: DockItem) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={label}
        to={href}
        aria-current={active ? 'page' : undefined}
        onClick={() => track('bottom_nav_tapped', { role: 'team', tab: label.toLowerCase() })}
        className={cn(
          'relative flex min-h-12 min-w-[56px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {active && (
          <motion.span layoutId="team-dock-pill" transition={spring} aria-hidden
            className="absolute inset-0.5 rounded-2xl bg-primary/10" />
        )}
        <Icon className="relative h-5 w-5" aria-hidden />
        <span className="relative">{label}</span>
      </Link>
    );
  };

  const go = (a: QuickAction) => {
    track('team_quick_action', { action: a.label.toLowerCase() });
    setOpen(false);
    navigate(a.href);
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button" aria-label="Close quick actions"
              className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              role="dialog" aria-modal="true" aria-label="Quick actions"
              className="fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),0.75rem)+5.25rem)] z-50 mx-auto max-w-md rounded-3xl bg-card p-3 shadow-2xl lg:hidden"
              initial={reduce ? false : { opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
              transition={spring}
            >
              <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Front desk</p>
              <ul className="grid grid-cols-2 gap-2">
                {actions.map((a, i) => (
                  <motion.li key={a.label}
                    initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={reduce ? { duration: 0 } : { ...spring, delay: i * 0.03 }}>
                    <button type="button" onClick={() => go(a)}
                      className="flex min-h-[72px] w-full cursor-pointer flex-col items-start gap-1 rounded-2xl bg-muted/60 p-3 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <a.icon className="h-5 w-5 text-accent" aria-hidden />
                      <span className="text-sm font-semibold text-foreground">{a.label}</span>
                      <span className="text-[11px] leading-tight text-muted-foreground">{a.hint}</span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav aria-label="Team app navigation"
        className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-50 mx-auto max-w-md lg:hidden">
        <div className="flex items-center gap-1 rounded-[28px] border border-border bg-card/90 px-2 py-1.5 shadow-2xl backdrop-blur-md">
          {left.map(renderTab)}
          <motion.button
            type="button"
            aria-label={open ? 'Close quick actions' : 'Open quick actions'}
            aria-expanded={open}
            whileTap={reduce ? undefined : { scale: 0.9 }}
            onClick={() => { setOpen((v) => !v); track('team_quick_action_toggle', { open: !open }); }}
            className="mx-1 grid h-14 w-14 shrink-0 -translate-y-3 cursor-pointer place-items-center rounded-full bg-accent text-accent-foreground shadow-lg ring-4 ring-background focus-visible:outline-none focus-visible:ring-primary"
          >
            <motion.span animate={{ rotate: open ? 45 : 0 }} transition={spring} className="grid place-items-center">
              {open ? <X className="h-6 w-6" aria-hidden /> : <Plus className="h-6 w-6" aria-hidden />}
            </motion.span>
          </motion.button>
          {right.map(renderTab)}
          <button type="button" aria-label="Open full menu"
            onClick={() => { track('bottom_nav_tapped', { role: 'team', tab: 'more' }); openMobileMenu('bottom_more'); }}
            className="flex min-h-12 min-w-[48px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Menu className="h-5 w-5" aria-hidden />More
          </button>
        </div>
      </nav>
    </>
  );
}
