// Single source of truth for where a facility booking came from (benefit_bookings.source).
// Values must match the benefit_bookings_source_check constraint and book_facility_slot's allow-list.
import type { LucideIcon } from 'lucide-react';
import { Apple, Bot, Building2, Globe, MessageCircle, Settings2, Smartphone } from 'lucide-react';

export const BOOKING_SOURCES = [
  'member_portal',
  'app_android',
  'app_ios',
  'whatsapp_ai',
  'concierge',
  'admin',
  'system',
] as const;

export type BookingSource = (typeof BOOKING_SOURCES)[number];

export interface BookingSourceMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

const META: Record<BookingSource, BookingSourceMeta> = {
  member_portal: { label: 'Web portal', icon: Globe, className: 'bg-success/10 text-success border-success/25' },
  app_android: { label: 'Android app', icon: Smartphone, className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' },
  app_ios: { label: 'iPhone app', icon: Apple, className: 'bg-muted text-foreground border-border' },
  whatsapp_ai: { label: 'WhatsApp', icon: MessageCircle, className: 'bg-info/10 text-info border-info/25' },
  concierge: { label: 'Concierge', icon: Bot, className: 'bg-primary/10 text-primary border-primary/25' },
  admin: { label: 'Front desk', icon: Building2, className: 'bg-warning/10 text-warning border-warning/25' },
  system: { label: 'System', icon: Settings2, className: 'bg-muted text-muted-foreground border-border' },
};

/** Missing/legacy values fall back to the web portal, matching how the server defaults member bookings. */
export function normalizeBookingSource(source?: string | null): BookingSource {
  return (BOOKING_SOURCES as readonly string[]).includes(source ?? '') ? (source as BookingSource) : 'member_portal';
}

export function bookingSourceMeta(source?: string | null): BookingSourceMeta {
  return META[normalizeBookingSource(source)];
}

export function isAppBooking(source?: string | null): boolean {
  const s = normalizeBookingSource(source);
  return s === 'app_android' || s === 'app_ios';
}
