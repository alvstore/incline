import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Dumbbell, Home, ShoppingBag, UserRound } from 'lucide-react';

const items = [
  { label: 'Home', href: '/member-dashboard', icon: Home },
  { label: 'Classes', href: '/book?type=classes', icon: CalendarDays },
  { label: 'Workout', href: '/my-workout', icon: Dumbbell },
  { label: 'Store', href: '/member-store', icon: ShoppingBag },
  { label: 'Profile', href: '/member-profile', icon: UserRound },
];

export function MemberMobileNav() {
  const location = useLocation();
  return (
    <nav aria-label="Member app navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-lg backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-lg items-center justify-around">
        {items.map(({ label, href, icon: Icon }) => {
          const active = href === '/book?type=classes'
            ? location.pathname === '/book'
            : location.pathname === href || false;
          return (
            <Link key={label} to={href} aria-current={active ? 'page' : undefined}
              className={`flex min-h-12 min-w-[58px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-primary'}`}>
              <Icon className="h-5 w-5" aria-hidden />{label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}