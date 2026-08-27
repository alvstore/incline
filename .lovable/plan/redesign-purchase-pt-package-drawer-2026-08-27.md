# Redesign: Purchase PT Package drawer

The current drawer stacks everything on one long scroll — a duplicate-package warning, a trainer card, plan tabs, a plan list, a custom-plan builder, schedule + GST + discount fields, and a footer that itself contains payment source, method, collect chips, UTR, due-date presets and a five-line total block. The footer alone is taller than the content area, so on a 1334x804 screen the totals and the primary button fall below the fold. There is no clear focal point and no sense of progress.

The rebuild turns it into a calm three-step wizard, keeping the same server behaviour.

## The new flow

**Step 1 — Plan & trainer**
- Trainer picker first (it drives commission), then Monthly / Session Pack toggle, then the plan cards.
- Plan cards get a cleaner layout: name, one metadata line, price right-aligned, selected state as a filled ring + check. "Build a custom plan" stays as the last dashed card and expands inline.
- Duplicate-package warning becomes a compact banner at the top of this step, not a full card.

**Step 2 — Schedule & pricing**
- Start date, live "Ends on" preview, and a plain-language line about when the trainer can mark attendance.
- Price summary: list price, discount (if any), GST treatment, final total.
- An **Advanced** disclosure (collapsed by default, visible only to roles that can view financials) holds: GST-exempt toggle, price override / discount, and "keep current trainer for general training".

**Step 3 — Payment**
- Payment source and method side by side; reference/UTR field appears only for UPI, card, bank transfer and cheque.
- "Collect now" chips (Full / 50% / Custom / Nothing yet) with the custom amount inline.
- Balance due date with the +7 / +10 / +15 / +30 presets plus a date picker — shown only when a balance remains.

**Persistent footer (all steps)**
- One compact summary bar: Final total, and when relevant "Collecting now" and "Balance due" on a single row each.
- Back / Next on steps 1–2; on step 3 the primary action reads `Collect ₹X & Assign` or `Charge & Assign · ₹X`.
- A three-dot step indicator in the header so progress is obvious.

## Behaviour tightening (agreed in scope)

- If the member already has an assigned trainer, preselect them.
- Default collect mode = Full; when the user drops to a partial amount, auto-set the due date to +7 days.
- Next is disabled with an inline reason (e.g. "Select a trainer", "Pick a plan") instead of a silently dead button.
- Reference field is required before submit for UPI / card / bank transfer / cheque, surfaced on the field.
- Proper loading skeletons for the trainer list and plan list, a real empty state when a branch has no packages, and an error state with retry instead of a bare spinner.

## Visual rules applied

Vuexy as usual: `rounded-2xl` cards, no borders, soft slate shadows, indigo/violet primary, Inter, `lucide-react` icons only, coloured status badges, 44px minimum touch targets, visible focus rings, and no horizontal scroll at 375px. The sheet stays right-side at `sm:max-w-lg`.

## Technical notes

- Single file rewrite: `src/components/pt/PurchasePTPackageDrawer.tsx` (1043 lines today), split into local sub-components for the three steps plus a `PtCheckoutSummary` footer so no single component is unreadable.
- No change to `purchase_pt_package` or `src/lib/payments/ptCheckout.ts` — the same arguments (`_amount_paid`, `_due_date`, `_transaction_id`, `_payment_notes`, GST, discount, trainer reassignment) are sent, only the way they're collected changes.
- Existing queries (trainers, catalog packages, blocking package check) and the idempotency key hook are reused as-is.
- Step state is local; the drawer resets on close as it does now.
- Verification: Playwright run at 1440 / 1024 / 375 px against the member profile, opening the drawer and walking all three steps, capturing console/network errors and asserting the totals and primary button are visible without scrolling.
