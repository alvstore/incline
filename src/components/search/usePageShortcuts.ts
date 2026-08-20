import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getMenuForRole, type MenuItem } from '@/config/menu';

/**
 * Build flat list of pages the current user can navigate to,
 * derived from the existing role-aware menu config (no hardcoding).
 */
export function usePageShortcuts(query: string) {
  const { roles, hasAnyRole } = useAuth();
  const isTrainerOnly = hasAnyRole(['trainer']) && !hasAnyRole(['owner', 'admin', 'manager', 'staff']);

  const allItems = useMemo<MenuItem[]>(() => {
    const sections = getMenuForRole(roles);
    let items = sections.flatMap((s) => s.items);
    
    // Trainers should not see the full Attendance Dashboard, just their personal one
    if (isTrainerOnly) {
      items = items.filter(i => i.href !== '/attendance-dashboard');
    }
    
    return items;
  }, [roles, isTrainerOnly]);

  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems.slice(0, 8);
    return allItems
      .filter((i) => i.label.toLowerCase().includes(q) || i.href.toLowerCase().includes(q))
      .slice(0, 10);
  }, [allItems, query]);
}
