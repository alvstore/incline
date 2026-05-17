// PT checkout math helper — single source of truth for GST split on PT purchases.
// Used by PurchasePTPackageDrawer so receptionists see exactly what is charged.

export interface PtCheckoutInput {
  /** Headline price entered by staff or stored on the catalog row. */
  price: number;
  /** GST percentage (e.g. 18). */
  gstPct: number;
  /** If true, `price` already includes GST; otherwise GST is added on top. */
  gstInclusive: boolean;
}

export interface PtCheckoutBreakdown {
  subtotal: number;
  tax: number;
  total: number;
  gstPct: number;
  gstInclusive: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computePtCheckout({
  price,
  gstPct,
  gstInclusive,
}: PtCheckoutInput): PtCheckoutBreakdown {
  const p = Math.max(0, Number(price) || 0);
  const g = Math.max(0, Number(gstPct) || 0);

  if (gstInclusive) {
    const subtotal = round2(p / (1 + g / 100));
    const tax = round2(p - subtotal);
    return { subtotal, tax, total: round2(p), gstPct: g, gstInclusive };
  }

  const subtotal = round2(p);
  const tax = round2((p * g) / 100);
  const total = round2(subtotal + tax);
  return { subtotal, tax, total, gstPct: g, gstInclusive };
}

export function formatINR(n: number): string {
  return `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
