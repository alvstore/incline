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

/** Fallback dedicated locker fee (pre-GST) used only until branch settings load. */
export const LOCKER_BASE_FEE: Record<LockerSize, number> = { Medium: 2500, Large: 3500 };
export const LOCKER_GST_RATE = 0.18;

export interface LockerPricingConfig {
  medium_fee: number;
  large_fee: number;
  gst_enabled: boolean;
  /** Percent, e.g. 18 */
  gst_rate: number;
}

export const DEFAULT_LOCKER_PRICING: LockerPricingConfig = {
  medium_fee: LOCKER_BASE_FEE.Medium,
  large_fee: LOCKER_BASE_FEE.Large,
  gst_enabled: true,
  gst_rate: LOCKER_GST_RATE * 100,
};

/** Quote for a dedicated locker valid until membership end (flat, never monthly). */
export function lockerPricing(size: LockerSize, cfg: LockerPricingConfig = DEFAULT_LOCKER_PRICING) {
  const base = Number(size === 'Large' ? cfg.large_fee : cfg.medium_fee) || 0;
  const rate = cfg.gst_enabled ? Number(cfg.gst_rate) || 0 : 0;
  const gst = Math.round(base * (rate / 100));
  return { base, gst, total: base + gst, gstRate: rate };
}
