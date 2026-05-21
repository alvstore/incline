// Maps audit_logs.table_name → category + deep-link route builder
export type AuditCategory =
  | 'members'
  | 'billing'
  | 'operations'
  | 'bookings'
  | 'catalog'
  | 'marketing'
  | 'staff'
  | 'system';

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  members: 'Members & Leads',
  billing: 'Billing',
  operations: 'Operations',
  bookings: 'Bookings',
  catalog: 'Catalog',
  marketing: 'Marketing',
  staff: 'Staff',
  system: 'System',
};

export const TABLE_CATEGORY: Record<string, AuditCategory> = {
  members: 'members',
  leads: 'members',
  memberships: 'members',
  lead_followups: 'members',
  member_comps: 'members',
  member_documents: 'members',
  referrals: 'members',

  invoices: 'billing',
  payments: 'billing',
  expenses: 'billing',
  wallet_transactions: 'billing',
  coupon_redemptions: 'billing',

  lockers: 'operations',
  equipment: 'operations',
  equipment_maintenance: 'operations',
  tasks: 'operations',
  contracts: 'operations',
  staff_attendance: 'operations',

  benefit_bookings: 'bookings',
  class_bookings: 'bookings',
  classes: 'bookings',
  pt_sessions: 'bookings',

  products: 'catalog',
  pt_packages: 'catalog',
  membership_plans: 'catalog',
  member_pt_packages: 'catalog',

  announcements: 'marketing',
  campaigns: 'marketing',

  employees: 'staff',
  trainers: 'staff',
  user_roles: 'staff',

  branches: 'system',
  integration_settings: 'system',
  access_devices: 'system',
  device_access_events: 'system',
};

const ROUTES: Record<string, (id: string) => string> = {
  members: (id) => `/members/${id}`,
  leads: (id) => `/leads?focus=${id}`,
  invoices: (id) => `/invoices?focus=${id}`,
  payments: (id) => `/invoices?payment=${id}`,
  trainers: (id) => `/trainers?focus=${id}`,
  employees: (id) => `/hrm?tab=employees&focus=${id}`,
  tasks: (id) => `/tasks?focus=${id}`,
  equipment: (id) => `/equipment-maintenance?focus=${id}`,
  lockers: (id) => `/lockers?focus=${id}`,
  classes: (id) => `/classes?focus=${id}`,
  benefit_bookings: (id) => `/all-bookings?focus=${id}`,
  class_bookings: (id) => `/all-bookings?focus=${id}`,
  contracts: (id) => `/hrm?tab=contracts&contract=${id}`,
  campaigns: (id) => `/campaigns?focus=${id}`,
  announcements: (id) => `/announcements?focus=${id}`,
  pt_packages: (id) => `/pt-sessions?package=${id}`,
  pt_sessions: (id) => `/pt-sessions?focus=${id}`,
  products: (id) => `/products?focus=${id}`,
  membership_plans: (id) => `/plans?focus=${id}`,
};

export function deepLinkFor(tableName: string, recordId: string | null): string | null {
  if (!recordId) return null;
  const f = ROUTES[tableName];
  return f ? f(recordId) : null;
}

export function categoryOf(tableName: string): AuditCategory {
  return TABLE_CATEGORY[tableName] || 'system';
}
