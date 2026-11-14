// v1.0.0 — Server-derived payment-link amount. Callers never set the price:
// the invoice balance is charged unless a staff member sends a part payment with a reason.
export type LinkAmountInput = {
  due: number;
  isStaff: boolean;
  mode?: unknown;
  partialAmount?: unknown;
  partialReason?: unknown;
  legacyAmount?: unknown;
};
export type LinkAmountResult =
  | { ok: true; amount: number; partial: boolean; reason: string | null }
  | { ok: false; code: string; error: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function resolvePaymentLinkAmount(i: LinkAmountInput): LinkAmountResult {
  const due = r2(Number(i.due) || 0);
  if (due < 1) return { ok: false, code: "NOTHING_DUE", error: "Nothing is due on this invoice" };

  let wantPartial = i.mode === "partial";
  let partialAmount = i.partialAmount;
  // Legacy callers sent `amount`: equal to due → full; otherwise treat as a partial request.
  if (!wantPartial && i.legacyAmount !== undefined && i.legacyAmount !== null) {
    const la = Number(i.legacyAmount);
    if (Number.isFinite(la) && Math.abs(la - due) > 0.01) {
      wantPartial = true;
      partialAmount = la;
    }
  }
  if (!wantPartial) return { ok: true, amount: due, partial: false, reason: null };

  if (!i.isStaff) {
    return { ok: false, code: "FULL_AMOUNT_REQUIRED", error: "Online payment must cover the full outstanding balance" };
  }
  const amt = r2(Number(partialAmount));
  if (!Number.isFinite(amt) || amt < 1) return { ok: false, code: "AMOUNT_TOO_LOW", error: "Amount must be at least ₹1" };
  if (amt > due + 0.01) return { ok: false, code: "AMOUNT_EXCEEDS_DUE", error: "Amount exceeds the outstanding balance" };
  if (Math.abs(amt - due) <= 0.01) return { ok: true, amount: due, partial: false, reason: null };
  const reason = typeof i.partialReason === "string" ? i.partialReason.trim() : "";
  if (reason.length < 5 || reason.length > 300) {
    return { ok: false, code: "PARTIAL_REASON_REQUIRED", error: "A reason (5–300 characters) is required for a part payment link" };
  }
  return { ok: true, amount: amt, partial: true, reason };
}
