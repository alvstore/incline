/** Shared shapes for the member-facing Renewal Concierge. */

export interface ConciergePlanOption {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationDays: number;
  gstRate: number | null;
  gstInclusive: boolean;
  /** Recovery / class perks bundled with the plan. */
  perks: string[];
  /** True when this is the plan the member is already on. */
  isCurrent: boolean;
}

export interface ConciergePtOption {
  id: string;
  name: string;
  sessions: number;
  price: number;
  validityDays: number;
  gstRate: number | null;
  gstInclusive: boolean;
}

export type ConciergeItemKind = 'membership' | 'pt';

export interface ConciergeSelection {
  kind: ConciergeItemKind;
  id: string;
  name: string;
  price: number;
  gstRate: number | null;
  gstInclusive: boolean;
  /** Short line under the item name in the receipt. */
  detail: string;
}

export interface ConciergeInvoiceSummary {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
  amountPaid: number;
  balance: number;
  status: string;
  dueDate: string | null;
}
