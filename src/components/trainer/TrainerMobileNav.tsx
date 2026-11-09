import { openMobileMenu } from '@/components/layout/AppSidebar';
import { Link, useLocation } from 'react-router-dom';
import { Dumbbell, Home, ListChecks, Menu, Users, Wallet } from 'lucide-react';
import { track } from '@/lib/analytics';

const items = [
  { label: 'Home', href: '/trainer-dashboard', icon: Home },
  { label: 'Clients', href: '/my-clients', icon: Users },
  { label: 'Plans', href: '/fitness/member-plans', icon: Dumbbell },
  { label: 'Tasks', href: '/tasks', icon: ListChecks },
  { label: 'Earnings', href: '/trainer-earnings', icon: Wallet },
];

/** Bottom dock for trainer-only accounts on phones/tablets (mirrors MemberMobileNav). */
export function TrainerMobileNav() {
  const { pathname } = useLocation();
  const cls = 'flex min-h-12 min-w-[52px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <nav aria-label="Trainer app navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-lg backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-lg items-center justify-around">
        {items.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={label} to={href} aria-current={active ? 'page' : undefined}
              onClick={() => track('bottom_nav_tapped', { role: 'trainer', tab: label.toLowerCase() })}
              className={`${cls} ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-primary'}`}>
              <Icon className="h-5 w-5" aria-hidden />{label}
            </Link>
          );
        })}
        <button type="button" aria-label="Open full menu" className={`${cls} text-muted-foreground hover:text-primary`}
          onClick={() => { track('bottom_nav_tapped', { role: 'trainer', tab: 'more' }); openMobileMenu('bottom_more'); }}>
          <Menu className="h-5 w-5" aria-hidden />More
        </button>
      </div>
    </nav>
  );
}
