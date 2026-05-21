import {
  LayoutDashboard, Users, ShoppingCart, Wallet, Wrench, Dumbbell,
  Heart, Briefcase, Megaphone, BarChart3, Settings,
} from 'lucide-react';
import type { MenuItem, MenuSection } from '@/config/menu';

export interface NavModule {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Section titles from menu.ts that belong here (case-insensitive). */
  sections?: string[];
  /** Hrefs (exact or prefix) explicitly assigned to this module. */
  hrefs?: string[];
  /** Href prefixes that should land here. */
  prefixes?: string[];
}

export const NAV_MODULES: NavModule[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    sections: ['Main', 'Dashboard'],
    hrefs: ['/dashboard', '/staff-dashboard', '/trainer-dashboard', '/member-dashboard'],
  },
  {
    id: 'members',
    label: 'Members',
    icon: Users,
    sections: ['Members & Leads', 'Member Management', 'My Account'],
    hrefs: ['/members', '/leads', '/attendance-dashboard', '/plans', '/referrals', '/feedback',
            '/my-plans', '/my-attendance', '/my-progress'],
  },
  {
    id: 'sales',
    label: 'Sales',
    icon: ShoppingCart,
    sections: ['E-Commerce & Sales'],
    hrefs: ['/pos', '/products', '/product-categories', '/store', '/discount-coupons', '/member-store', '/my-invoices'],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: Wallet,
    sections: ['Finance'],
    hrefs: ['/finance', '/invoices', '/payments', '/trainer-earnings'],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: Wrench,
    sections: ['Core'],
    hrefs: ['/equipment-maintenance', '/lockers', '/devices', '/follow-up-center', '/all-bookings', '/tasks'],
  },
  {
    id: 'pt',
    label: 'PT/Trainers',
    icon: Dumbbell,
    sections: ['Training & Bookings', 'Training', 'Earnings'],
    hrefs: ['/classes', '/pt-sessions', '/trainers', '/schedule-session', '/my-clients',
            '/my-pt-sessions', '/my-workout', '/my-diet'],
    prefixes: ['/fitness/'],
  },
  {
    id: 'benefits',
    label: 'Benefits',
    icon: Heart,
    hrefs: ['/benefit-tracking', '/book-benefit', '/my-benefits'],
    prefixes: ['/benefit'],
  },
  {
    id: 'hrm',
    label: 'HRM',
    icon: Briefcase,
    sections: ['Admin & HR', 'Work'],
    hrefs: ['/hrm', '/staff-attendance', '/approvals'],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    icon: Megaphone,
    sections: ['Operations & Comm', 'Communication'],
    hrefs: ['/whatsapp-chat', '/contact-book', '/announcements', '/campaigns', '/instagram-automations', '/member-announcements', '/member-feedback', '/my-requests', '/my-referrals'],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart3,
    hrefs: ['/analytics', '/reports', '/audit-logs', '/system-health'],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    hrefs: ['/settings', '/admin-roles', '/integration-webhooks'],
  },
];

export interface ModuleGroup {
  module: NavModule;
  items: MenuItem[];
}

function normalize(s: string) { return s.trim().toLowerCase(); }

/** Group already-RBAC-filtered sections into top modules (preserving order, dedup by href). */
export function groupMenuIntoModules(sections: MenuSection[]): ModuleGroup[] {
  const allItems: MenuItem[] = sections.flatMap((sec) =>
    sec.items.map((it) => ({ ...it, __section: sec.title } as MenuItem & { __section: string })),
  );

  const used = new Set<string>();
  const groups: ModuleGroup[] = [];

  for (const mod of NAV_MODULES) {
    const sectionSet = new Set((mod.sections ?? []).map(normalize));
    const hrefSet = new Set(mod.hrefs ?? []);
    const prefixes = mod.prefixes ?? [];

    const items: MenuItem[] = [];
    for (const item of allItems) {
      if (used.has(item.href)) continue;
      const sec = (item as MenuItem & { __section?: string }).__section ?? '';
      const matchSection = sectionSet.has(normalize(sec));
      const matchHref = hrefSet.has(item.href);
      const matchPrefix = prefixes.some((p) => item.href.startsWith(p));
      if (matchSection || matchHref || matchPrefix) {
        items.push(item);
        used.add(item.href);
      }
    }

    if (items.length > 0) groups.push({ module: mod, items });
  }

  // Sweep any leftovers into a synthetic "More" module so nothing disappears.
  const leftovers = allItems.filter((it) => !used.has(it.href));
  if (leftovers.length > 0) {
    groups.push({
      module: { id: 'more', label: 'More', icon: Settings },
      items: leftovers,
    });
  }

  return groups;
}

/** Pick the active module based on the current pathname (longest matching href wins). */
export function findActiveModuleId(groups: ModuleGroup[], pathname: string): string | undefined {
  let bestId: string | undefined;
  let bestLen = -1;
  for (const g of groups) {
    for (const item of g.items) {
      if (pathname === item.href || pathname.startsWith(item.href + '/')) {
        if (item.href.length > bestLen) {
          bestLen = item.href.length;
          bestId = g.module.id;
        }
      }
    }
  }
  return bestId ?? groups[0]?.module.id;
}
