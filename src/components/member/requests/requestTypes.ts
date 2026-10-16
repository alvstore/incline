import { Snowflake, Sun, User, Lock, UtensilsCrossed, Dumbbell } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type RequestKind = 'freeze' | 'unfreeze' | 'trainer' | 'locker' | 'diet' | 'workout';

export interface RequestOption {
  kind: RequestKind;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon badge */
  tone: string;
  /** When set the option is shown but not actionable */
  disabledReason?: string;
}

export const REQUEST_ICONS: Record<RequestKind, LucideIcon> = {
  freeze: Snowflake,
  unfreeze: Sun,
  trainer: User,
  locker: Lock,
  diet: UtensilsCrossed,
  workout: Dumbbell,
};

export const REQUEST_TITLES: Record<RequestKind, string> = {
  freeze: 'Freeze membership',
  unfreeze: 'Resume membership',
  trainer: 'Trainer',
  locker: 'Locker',
  diet: 'Diet plan',
  workout: 'Workout plan',
};

export const LOCKER_SIZES = ['Medium', 'Large'] as const;
export type LockerSize = (typeof LOCKER_SIZES)[number];

/** Dedicated locker fee (pre-GST), valid until the member's current membership ends. */
export const LOCKER_BASE_FEE: Record<LockerSize, number> = { Medium: 2500, Large: 3500 };
export const LOCKER_GST_RATE = 0.18;

export function lockerPricing(size: LockerSize) {
  const base = LOCKER_BASE_FEE[size];
  const gst = Math.round(base * LOCKER_GST_RATE);
  return { base, gst, total: base + gst };
}
