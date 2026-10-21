// v1.0.0 — Pure helpers for WhatsApp expense capture (no Deno/runtime imports, unit-tested).

export type ExpenseMode = "cash" | "upi" | "card" | "bank_transfer" | "cheque";

const MODE_ALIASES: Record<string, ExpenseMode> = {
  cash: "cash", nakad: "cash",
  upi: "upi", gpay: "upi", phonepe: "upi", paytm: "upi", "google pay": "upi",
  card: "card", "debit card": "card", "credit card": "card",
  bank: "bank_transfer", "bank transfer": "bank_transfer", bank_transfer: "bank_transfer", neft: "bank_transfer", imps: "bank_transfer", rtgs: "bank_transfer", transfer: "bank_transfer",
  cheque: "cheque", check: "cheque",
};

export function normalizeExpenseMode(v: unknown): ExpenseMode | null {
  const k = String(v ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!k) return null;
  return MODE_ALIASES[k] ?? MODE_ALIASES[k.replace(/ /g, "_")] ?? null;
}

export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  const s = String(v ?? "").toLowerCase().replace(/₹|rs\.?|inr|,|\s/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(k)?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Resolve "today" / "yesterday" / YYYY-MM-DD / DD-MM-YYYY to an IST date string. */
export function resolveExpenseDate(v: unknown, todayIST: string): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s === "today" || s === "aaj" || s === "just now" || s === "now") return todayIST;
  if (s === "yesterday" || s === "kal") {
    const d = new Date(`${todayIST}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s <= todayIST ? s : null;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return iso <= todayIST ? iso : null;
  }
  return null;
}

/** Default expense type when paying a team member. "advance" → salary advance; allowance words → general. */
export function defaultExpenseType(note: string, payeeIsStaff: boolean): "general" | "salary_advance" {
  if (!payeeIsStaff) return "general";
  const t = note.toLowerCase();
  if (/\badvance\b|udhar|loan/.test(t)) return "salary_advance";
  return "general";
}

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/rent|housing|lease|kiraya/, "Rent or Mortgage"],
  [/electric|bijli|water|internet|wifi|gas|utility/, "Utilities"],
  [/clean|housekeep|sweep|detergent/, "Cleaning & Maintenance"],
  [/repair|plumb|electrician|fix|ac service/, "Maintenance & Repairs"],
  [/marketing|ads?\b|advert|flyer|banner|promotion/, "Marketing & Advertising"],
  [/salary|wage|advance|allowance|bonus|incentive/, "Salaries & Wages"],
  [/stationery|office|printing|supplies/, "Administrative Supplies"],
  [/stock|inventory|supplement|protein/, "Retail Inventory"],
  [/instructor|coach fee|trainer fee/, "Instructor Fees"],
];

export function guessCategory(note: string, payeeIsStaff: boolean): string | null {
  const t = note.toLowerCase();
  for (const [re, name] of CATEGORY_RULES) if (re.test(t)) return name;
  return payeeIsStaff ? "Salaries & Wages" : null;
}

export function matchCategoryId(name: string | null, cats: Array<{ id: string; name: string }>): string | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/[^a-z]/g, "");
  const hit = cats.find((c) => c.name.toLowerCase().replace(/[^a-z]/g, "") === n)
    ?? cats.find((c) => c.name.toLowerCase().replace(/[^a-z]/g, "").startsWith(n.slice(0, 6)));
  return hit?.id ?? null;
}

export function canCaptureExpense(role: string | null | undefined): boolean {
  return ["owner", "admin", "manager"].includes(String(role || "").toLowerCase());
}
