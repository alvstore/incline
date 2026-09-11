# Device Centre, Voice AI, member payments and steam booking

Four fixes, verified against live data before writing this plan.

---

## 1. Device page — one truth for face photos

**What's wrong today (confirmed):** three surfaces count faces three different ways, so the same page says "154 of 166", "missing 12", "missing 6" and "166/176" at once.

- The yellow banner compares each gate's own photo counter against the MIPS server total.
- The Personnel Sync tab compares CRM photos against the MIPS person list.
- The per-gate panel then splits the same gate into confirmed / counted / still to send / needs a new photo — and those four numbers do not add up to the "missing 12" in the banner.

**What changes**

- One shared calculation for every surface. Each gate reports: photos it holds, target, and a gap split into three named buckets that always sum to the gap — *waiting to be sent*, *rejected by the gate (needs a new photo)*, and *unaccounted*. No surface may invent its own arithmetic.
- The banner stops leading with a raw number. It states the action: how many people need a fresh photo (staff action) versus how many are simply queued (no action). "Re-sync faces" only appears when there is something re-sending can actually fix — if every remaining gap is a rejected photo, the button is replaced by "View people needing a new photo".
- "MIPS server reachable — last successful contact about 1 month ago" is contradictory. Reachability and last-contact are shown as one honest status, and a stale timestamp downgrades the badge instead of showing "Healthy".
- The Personnel Sync tab keeps its KPIs but re-labels them so "Missing face 6" and "missing 12/16" are visibly the same people counted at different stages, with a single explanatory line.
- Fleet actions (Fleet sync, Reconcile devices, Revoke expired, Full roster sync, Open door, Faces, door role) keep their exact current behaviour — wiring is untouched. Each gains a confirm-and-result state so a click always reports what happened.
- Face enrolment sweep being paused is shown as a banner with the reason, not a grey sentence.

Layout: status strip, then one attention banner, then tabs (Fleet · Personnel Sync · Face Truth · Live Feed). Face Truth moves out of Personnel Sync into its own tab.

---

## 2. Voice AI — a real calling workflow

**What's wrong today:** tabs are separate queries that can disagree, the queue shows no next attempt, unreached members have no visible retry rhythm, and several controls give no feedback.

**Call lifecycle (new, enforced server-side)**

```text
Due  ->  Queued  ->  Calling  ->  Reached  -> outcome recorded
                        |
                        +-> No answer / busy -> Retry 1 (+3h)  -> Retry 2 (next day)
                                                 |                    |
                                                 +--------------------+-> Unreachable -> human task
```

- Up to 3 attempts per member per cycle, spaced inside the calling window, never outside it and never past the daily cap.
- Every row in the queue and history shows **Next attempt at ...** or the reason there is none (cap reached, cooldown, do-not-contact, window closed).
- Attempt counter ("2 of 3") on each member.

**Page structure**

- Header: agent, number, window, cap used, readiness, Pause / Resume, Refresh.
- Tabs: **Today** (due, in progress, done today) · **History** · **Needs attention** (callbacks, complaints, human follow-up merged, each with the owning task and its status) · **Not called** (skipped/blocked with the exact reason) · **Analytics**.
- Every action button reports its result: Call now, Retry unreached, Pause, Mark handled. Buttons that cannot act (no phone, do-not-contact, outside window) are disabled with the reason on hover, not silently inert.
- All tabs read from one shared, branch-scoped source so counts cannot disagree.

---

## 3. Member payments — no invoice before money

**Confirmed:** INV-INC-26-0123 (add-on, ₹1,500) was created by a member from their own dashboard and immediately recorded as **cash / paid**, although no cash was taken. The member had chosen "Pay at front desk", and the purchase routine settles the invoice in the same step regardless.

**What changes**

- A member buying from their dashboard has exactly one path: **pay online**. The "pay at front desk" option is removed from the member view (staff keep all their methods).
- No invoice, no credits and no payment record are created until the gateway confirms payment. A cancelled or abandoned checkout leaves nothing behind.
- A **convenience charge** is added as its own visible line before payment — a configurable percentage per branch, shown in the summary ("Amount ₹1,500 + convenience 2% ₹30 = ₹1,530") and printed on the invoice.
- The purchase routine is corrected so a non-payment method can never be recorded as cash.
- INV-INC-26-0123 is reviewed with you and corrected (void or collect) rather than silently altered.

---

## 4. Steam booking

Steam exists as a plan benefit but there is **no steam room**, which is why it cannot be booked — sauna and ice bath each have male and female rooms, steam has none.

- Create **Steam Male** and **Steam Female** rooms with capacity, operating days and hours, mirroring sauna.
- Slots then generate automatically and members book steam from their dashboard exactly like sauna. No new booking code — unlimited-plan members book without charge, others use their credits.
- You confirm capacity and timings for each room before it goes live.

---

## Technical notes

- New shared hook derived from `useMipsFleet` returning one gate-gap model; `DeviceAttentionBar`, `DeviceHealthStrip`, `DeviceFleetTab`, `PersonnelSyncTab` and `FaceEnrolmentPanel` all consume it. No MIPS edge function behaviour changes.
- Voice: retry scheduling and `next_attempt_at` added to the attempt records and to the queue/feed RPCs; `VoiceAI.tsx` rebuilt over the consolidated hooks in `useVoiceOps.ts`. Eligibility, window, cap and concurrency stay in `sarvam-voice`.
- Payments: `PurchaseAddOnDrawer` member mode becomes online-only; `purchase_benefit_credits` gains an unpaid-until-verified path plus a convenience-fee line item, with the fee percentage stored in branch settings. Razorpay flow reuses the existing invoice gateway path.
- Facilities: data-only rows in `facilities` for steam; existing `ensure_facility_slots` and `book_facility_slot` handle the rest.

## Verification

Gate numbers identical across all four device surfaces; every device button reports a result; Voice AI counts consistent across tabs with next-attempt shown; member checkout leaves no invoice on cancellation and creates a paid invoice with the convenience line on success; steam bookable end-to-end from a member dashboard.
