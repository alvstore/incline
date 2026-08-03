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

export const LOCKER_SIZES = ['Small', 'Medium', 'Large'] as const;
export type LockerSize = (typeof LOCKER_SIZES)[number];
