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

/* ---------------- Trainer change / request ---------------- */

export const TRAINER_CHANGE_REASONS = [
  { code: 'schedule', label: "Schedule doesn't match" },
  { code: 'guidance', label: 'Not satisfied with guidance' },
  { code: 'communication', label: 'Communication / punctuality' },
  { code: 'style', label: 'Want a different training style' },
  { code: 'comfort', label: 'Personal comfort / prefer other gender' },
  { code: 'other', label: 'Other' },
] as const;
export type TrainerChangeReason = (typeof TRAINER_CHANGE_REASONS)[number]['code'];

export const TRAINER_GOALS = ['Weight loss', 'Strength', 'Mobility', 'Rehab', 'General fitness'] as const;
export const TRAINER_SLOTS = ['Morning', 'Afternoon', 'Evening'] as const;

/** Reasons that point at a service problem with the current trainer → high-priority escalation. */
export function isEscalationReason(code: string | null | undefined): boolean {
  return code === 'guidance' || code === 'communication';
}

/** Reasons where the member must explain what happened. */
export function reasonNeedsDetails(code: string | null | undefined): boolean {
  return code === 'other' || isEscalationReason(code);
}

export function trainerReasonLabel(code: string | null | undefined): string | null {
  return TRAINER_CHANGE_REASONS.find((r) => r.code === code)?.label ?? null;
}

/**
 * Validates a change-trainer submission.
 * When the kill switch is off, only a free-text note is required (legacy flow).
 */
export function validateTrainerChange(input: {
  flagOn: boolean;
  hasTrainer: boolean;
  reason: string | null;
  details: string;
}): string | null {
  const details = input.details.trim();
  if (!input.flagOn) return details ? null : 'Please describe your request.';
  if (!input.hasTrainer) return null;
  if (!input.reason) return 'Choose a reason.';
  if (reasonNeedsDetails(input.reason) && details.length < 10) return 'Please add at least 10 characters of detail.';
  if (details.length > 500) return 'Keep details under 500 characters.';
  return null;
}
