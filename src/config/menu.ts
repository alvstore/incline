import type { Database } from '@/integrations/supabase/types';
import {
  LayoutDashboard, Users, UserPlus, CreditCard, Calendar, Dumbbell, Package,
  Settings, ClipboardList, Megaphone, BarChart3, Wallet, Clock,
  Lock, Sparkles, ShoppingBag, ShoppingCart, Gift, FileText, Wrench, CheckSquare, 
  Briefcase, MessageSquare, Tags, Activity, UtensilsCrossed, Target, 
  Bell, Snowflake, UserCog, TrendingUp, Heart, Router, BookUser, Instagram
} from 'lucide-react';

type AppRole = Database['public']['Enums']['app_role'];

export interface MenuItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: AppRole[];
  /** Extra runtime gate. 'has_pt_package' → only show to members with a PT package. */
  requires?: 'has_pt_package';
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

// Member-specific menu
export const memberMenuConfig: MenuSection[] = [
  {
    title: 'My Account',
    items: [
      { label: 'Dashboard', href: '/member-dashboard', icon: LayoutDashboard, roles: ['member'] },
      { label: 'My Plans', href: '/my-plans', icon: CreditCard, roles: ['member'] },
      { label: 'My Attendance', href: '/my-attendance', icon: Clock, roles: ['member'] },
      { label: 'My Progress', href: '/my-progress', icon: TrendingUp, roles: ['member'] },
    ],
  },
  {
    title: 'Fitness',
    items: [
      { label: 'Book & Schedule', href: '/my-classes', icon: Calendar, roles: ['member'] },
      { label: 'Book a Benefit', href: '/book-benefit', icon: Heart, roles: ['member'] },
      { label: 'PT Sessions', href: '/my-pt-sessions', icon: Dumbbell, roles: ['member'], requires: 'has_pt_package' },
      { label: 'Workout Plan', href: '/my-workout', icon: Activity, roles: ['member'] },
      { label: 'Diet Plan', href: '/my-diet', icon: UtensilsCrossed, roles: ['member'] },
    ],
  },
  {
    title: 'Services',
    items: [
      { label: 'Refer & Earn', href: '/my-referrals', icon: Gift, roles: ['member'] },
      { label: 'Store', href: '/member-store', icon: ShoppingBag, roles: ['member'] },
      { label: 'My Invoices', href: '/my-invoices', icon: FileText, roles: ['member'] },
      { label: 'My Requests', href: '/my-requests', icon: Target, roles: ['member'] },
    ],
  },
  {
    title: 'Communication',
    items: [
      { label: 'Announcements', href: '/member-announcements', icon: Megaphone, roles: ['member'] },
      { label: 'Feedback', href: '/member-feedback', icon: MessageSquare, roles: ['member'] },
    ],
  },
];

// Trainer-specific menu
export const trainerMenuConfig: MenuSection[] = [
  {
    title: 'Dashboard',
    items: [
      { label: 'My Dashboard', href: '/trainer-dashboard', icon: LayoutDashboard, roles: ['trainer'] },
    ],
  },
  {
    title: 'Training',
    items: [
      { label: 'My Clients', href: '/my-clients', icon: Users, roles: ['trainer'] },
      { label: 'PT Sessions', href: '/pt-sessions', icon: Dumbbell, roles: ['trainer'] },
      
      { label: 'Schedule Session', href: '/schedule-session', icon: Calendar, roles: ['trainer'] },
      { label: 'My Classes', href: '/classes', icon: Calendar, roles: ['trainer'] },
      { label: 'Diet & Workout', href: '/fitness/create', icon: Dumbbell, roles: ['trainer'] },
    ],
  },
  {
    title: 'Earnings',
    items: [
      { label: 'My Earnings', href: '/trainer-earnings', icon: Wallet, roles: ['trainer'] },
    ],
  },
  {
    title: 'Work',
    items: [
      { label: 'My Attendance', href: '/attendance-dashboard', icon: Clock, roles: ['trainer'] },
      { label: 'Announcements', href: '/announcements', icon: Megaphone, roles: ['trainer'] },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Preferences', href: '/settings?tab=appearance', icon: Settings, roles: ['trainer'] },
    ],
  },
];

// Staff-specific menu
export const staffMenuConfig: MenuSection[] = [
  {
    title: 'Core',
    items: [
      { label: 'Dashboard', href: '/staff-dashboard', icon: LayoutDashboard, roles: ['staff'] },
      { label: 'Follow-Up Center', href: '/follow-up-center', icon: Target, roles: ['staff'] },
    ],
  },
  {
    title: 'Member Management',
    items: [
      { label: 'Members', href: '/members', icon: Users, roles: ['staff'] },
      { label: 'Attendance', href: '/attendance-dashboard', icon: Clock, roles: ['staff'] },
      { label: 'Leads', href: '/leads', icon: UserPlus, roles: ['staff'] },
      { label: 'Feedback', href: '/feedback', icon: MessageSquare, roles: ['staff'] },
    ],
  },
  {
    title: 'Training & Bookings',
    items: [
      { label: 'Classes', href: '/classes', icon: Calendar, roles: ['staff'] },
      { label: 'PT Sessions', href: '/pt-sessions', icon: Dumbbell, roles: ['staff'] },
      
      { label: 'All Bookings', href: '/all-bookings', icon: Calendar, roles: ['staff'] },
      { label: 'Benefit Tracking', href: '/benefit-tracking', icon: Heart, roles: ['staff'] },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'POS', href: '/pos', icon: ShoppingCart, roles: ['staff'] },
      { label: 'Invoices', href: '/invoices', icon: FileText, roles: ['staff'] },
      { label: 'Payments', href: '/payments', icon: Wallet, roles: ['staff'] },
      { label: 'Equipment', href: '/equipment-maintenance', icon: Wrench, roles: ['staff'] },
      { label: 'Lockers', href: '/lockers', icon: Lock, roles: ['staff'] },
      { label: 'Tasks', href: '/tasks', icon: CheckSquare, roles: ['staff'] },
    ],
  },
  {
    title: 'Communication',
    items: [
      { label: 'Chats', href: '/whatsapp-chat', icon: MessageSquare, roles: ['staff'] },
      { label: 'Contact Book', href: '/contact-book', icon: BookUser, roles: ['staff'] },
      { label: 'Announcements', href: '/announcements', icon: Megaphone, roles: ['staff'] },
    ],
  },
  {
    title: 'Work',
    items: [
      { label: 'My Attendance', href: '/attendance-dashboard', icon: Clock, roles: ['staff'] },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Preferences', href: '/settings?tab=appearance', icon: Settings, roles: ['staff'] },
    ],
  },
];

// Admin/Owner menu (full access)
export const adminMenuConfig: MenuSection[] = [
  {
    title: 'Main',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['owner', 'admin', 'manager'] },
      { label: 'Analytics', href: '/analytics', icon: BarChart3, roles: ['owner', 'admin', 'manager'] },
    ],
  },
  {
    title: 'Members & Leads',
    items: [
      { label: 'Leads', href: '/leads', icon: UserPlus, roles: ['owner', 'admin', 'manager'] },
      { label: 'Members', href: '/members', icon: Users, roles: ['owner', 'admin', 'manager'] },
      { label: 'Attendance', href: '/attendance-dashboard', icon: Clock, roles: ['owner', 'admin', 'manager'] },
      { label: 'Plans', href: '/plans', icon: CreditCard, roles: ['owner', 'admin', 'manager'] },
      { label: 'Referrals', href: '/referrals', icon: Gift, roles: ['owner', 'admin', 'manager'] },
      { label: 'Feedback', href: '/feedback', icon: MessageSquare, roles: ['owner', 'admin', 'manager'] },
    ],
  },
  {
    title: 'Training & Bookings',
    items: [
      { label: 'Classes', href: '/classes', icon: Calendar, roles: ['owner', 'admin', 'manager'] },
      { label: 'PT Sessions', href: '/pt-sessions', icon: Dumbbell, roles: ['owner', 'admin', 'manager'] },
      
      { label: 'Trainers', href: '/trainers', icon: Dumbbell, roles: ['owner', 'admin', 'manager'] },
      { label: 'All Bookings', href: '/all-bookings', icon: Calendar, roles: ['owner', 'admin', 'manager'] },
      { label: 'Benefit Tracking', href: '/benefit-tracking', icon: Heart, roles: ['owner', 'admin', 'manager'] },
      { label: 'Diet & Workout', href: '/fitness/create', icon: Dumbbell, roles: ['owner', 'admin', 'manager'] },
    ],
  },
  {
    title: 'E-Commerce & Sales',
    items: [
      { label: 'POS', href: '/pos', icon: ShoppingCart, roles: ['owner', 'admin', 'manager'] },
      { label: 'Products', href: '/products', icon: Package, roles: ['owner', 'admin', 'manager'] },
      { label: 'Categories', href: '/product-categories', icon: Tags, roles: ['owner', 'admin', 'manager'] },
      { label: 'Store Orders', href: '/store', icon: ShoppingBag, roles: ['owner', 'admin', 'manager'] },
      { label: 'Discount Coupons', href: '/discount-coupons', icon: Tags, roles: ['owner', 'admin', 'manager'] },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Overview', href: '/finance', icon: Wallet, roles: ['owner', 'admin', 'manager'] },
      { label: 'Invoices', href: '/invoices', icon: FileText, roles: ['owner', 'admin', 'manager'] },
      { label: 'Payments', href: '/payments', icon: Wallet, roles: ['owner', 'admin', 'manager'] },
    ],
  },
  {
    title: 'Operations & Comm',
    items: [
      { label: 'Chats', href: '/whatsapp-chat', icon: MessageSquare, roles: ['owner', 'admin', 'manager'] },
      { label: 'Contact Book', href: '/contact-book', icon: BookUser, roles: ['owner', 'admin', 'manager'] },
      { label: 'Communication Hub', href: '/announcements', icon: Megaphone, roles: ['owner', 'admin', 'manager'] },
      { label: 'Equipment', href: '/equipment-maintenance', icon: Wrench, roles: ['owner', 'admin', 'manager'] },
      { label: 'Lockers', href: '/lockers', icon: Lock, roles: ['owner', 'admin', 'manager'] },
      { label: 'Devices', href: '/devices', icon: Router, roles: ['owner', 'admin'] },
    ],
  },
  {
    title: 'Admin & HR',
    items: [
      { label: 'HRM', href: '/hrm', icon: Briefcase, roles: ['owner', 'admin', 'manager'] },
      { label: 'Staff Roster', href: '/staff-roster', icon: Clock, roles: ['owner', 'admin', 'manager'] },
      { label: 'Roles and Permission', href: '/admin-roles', icon: UserCog, roles: ['owner', 'admin'] },
      
      { label: 'Tasks', href: '/tasks', icon: CheckSquare, roles: ['owner', 'admin', 'manager'] },
      { label: 'Approvals', href: '/approvals', icon: CheckSquare, roles: ['owner', 'admin', 'manager'] },
      { label: 'System Health', href: '/system-health', icon: Activity, roles: ['owner', 'admin'] },
      { label: 'Audit Logs', href: '/audit-logs', icon: ClipboardList, roles: ['owner', 'admin'] },
      { label: 'Settings', href: '/settings', icon: Settings, roles: ['owner', 'admin'] },
    ],
  },
];


// Manager-specific menu
export const managerMenuConfig: MenuSection[] = [
  {
    title: 'Main',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['manager'] },
      { label: 'Analytics', href: '/analytics', icon: BarChart3, roles: ['manager'] },
    ],
  },
  {
    title: 'Members & Leads',
    items: [
      { label: 'Leads', href: '/leads', icon: UserPlus, roles: ['manager'] },
      { label: 'Members', href: '/members', icon: Users, roles: ['manager'] },
      { label: 'Attendance', href: '/attendance-dashboard', icon: Clock, roles: ['manager'] },
      { label: 'Plans', href: '/plans', icon: CreditCard, roles: ['manager'] },
      { label: 'Referrals', href: '/referrals', icon: Gift, roles: ['manager'] },
      { label: 'Feedback', href: '/feedback', icon: MessageSquare, roles: ['manager'] },
    ],
  },
  {
    title: 'Training & Bookings',
    items: [
      { label: 'Classes', href: '/classes', icon: Calendar, roles: ['manager'] },
      { label: 'PT Sessions', href: '/pt-sessions', icon: Dumbbell, roles: ['manager'] },
      
      { label: 'Trainers', href: '/trainers', icon: Dumbbell, roles: ['manager'] },

      { label: 'All Bookings', href: '/all-bookings', icon: Calendar, roles: ['manager'] },
      { label: 'Benefit Tracking', href: '/benefit-tracking', icon: Heart, roles: ['manager'] },
    ],
  },
  {
    title: 'E-Commerce & Sales',
    items: [
      { label: 'POS', href: '/pos', icon: ShoppingCart, roles: ['manager'] },
      { label: 'Products', href: '/products', icon: Package, roles: ['manager'] },
      { label: 'Categories', href: '/product-categories', icon: Tags, roles: ['manager'] },
      { label: 'Store Orders', href: '/store', icon: ShoppingBag, roles: ['manager'] },
      { label: 'Discount Coupons', href: '/discount-coupons', icon: Tags, roles: ['manager'] },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Overview', href: '/finance', icon: Wallet, roles: ['manager'] },
      { label: 'Invoices', href: '/invoices', icon: FileText, roles: ['manager'] },
      { label: 'Payments', href: '/payments', icon: Wallet, roles: ['manager'] },
    ],
  },
  {
    title: 'Operations & Comm',
    items: [
      { label: 'Chats', href: '/whatsapp-chat', icon: MessageSquare, roles: ['manager'] },
      { label: 'Contact Book', href: '/contact-book', icon: BookUser, roles: ['manager'] },
      { label: 'Communication Hub', href: '/announcements', icon: Megaphone, roles: ['manager'] },
      { label: 'Equipment', href: '/equipment-maintenance', icon: Wrench, roles: ['manager'] },
      { label: 'Lockers', href: '/lockers', icon: Lock, roles: ['manager'] },
    ],
  },
  {
    title: 'Admin & HR',
    items: [
      { label: 'HRM', href: '/hrm', icon: Briefcase, roles: ['manager'] },
      { label: 'Staff Roster', href: '/staff-roster', icon: Clock, roles: ['manager'] },
      

      
      
      { label: 'Tasks', href: '/tasks', icon: CheckSquare, roles: ['manager'] },
      { label: 'Approvals', href: '/approvals', icon: CheckSquare, roles: ['manager'] },
      { label: 'Preferences', href: '/settings?tab=appearance', icon: Settings, roles: ['manager'] },
    ],
  },
];

// Legacy menuConfig - kept for backward compatibility but use role-specific ones
export const menuConfig: MenuSection[] = adminMenuConfig;

// Helper function to get menu by primary role
export function getMenuForRole(roles: Array<{ role: AppRole }>): MenuSection[] {
  const roleSet = new Set(roles.map(r => r.role));

  // Priority: member > trainer > staff > manager > admin/owner
  if (roleSet.has('member')) {
    return memberMenuConfig;
  }
  if (roleSet.has('trainer') && !roleSet.has('owner') && !roleSet.has('admin') && !roleSet.has('manager')) {
    return trainerMenuConfig;
  }
  if (roleSet.has('staff') && !roleSet.has('owner') && !roleSet.has('admin') && !roleSet.has('manager')) {
    return staffMenuConfig;
  }
  // Manager WITHOUT admin/owner gets restricted menu
  if (roleSet.has('manager') && !roleSet.has('owner') && !roleSet.has('admin')) {
    return managerMenuConfig;
  }
  return adminMenuConfig;
}
