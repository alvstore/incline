# Fix: PT "Expired (30d)" shows members who already continued

## What I found (live data)
The PT Clients "Expired (30d)" tab lists every expired package, without checking whether the same member already has a newer package. 3 of the 11 members shown have already continued:
- INC-26-0041 — new package active 2 Nov 2026 → 1 Feb 2027
- INC-26-0100 (Sahiba Mehndiratta) — active until 19 Nov 2026
- INC-26-0161 (Ananya Bagla) — active until 10 Nov 2026

The other 8 genuinely have no follow-on package and should stay.

## Changes
1. **Expired tab = only real lapses.** An expired package is hidden from "Expired (30d)" (and its count) when the same member has a newer active or awaiting-payment PT package that ends on or after it. The tab label/count updates to match (expected 8).
2. **"Continued" marker instead of losing history.** In the member's package history drawer the old package keeps showing, with a small "Continued → <new package>" note so staff can still see it.
3. **Renew button awareness.** On "All active" rows ending soon, if the member already has a queued/next package, show "Renewed · starts <date>" instead of the Renew button, so staff don't sell twice.
4. **Accessibility.** Filter chips announce counts (`aria-pressed`, count in label); the new "Renewed" state uses icon + text, not colour alone.

No feature flag needed — this is a display-only correction, no data or billing changes.

## Technical details
- `src/components/pt/ClientsTable.tsx`: build a `Map<member_id, PTMemberPackageRow[]>` from `rows`; `hasSuccessor(p)` = another row for the same member with status in (`active`,`pending_payment`) and `expiry_date >= p.expiry_date`. `matchers.expired = p => isExpired(p) && !hasSuccessor(p)`; `primaryOf` returns a disabled "Renewed" state when a later-starting successor exists.
- Confirm `PTSessions.tsx` passes active + pending + 30-day expired rows together (needed for the successor check); widen the query only if pending rows are missing.
- Add a small unit test for `hasSuccessor` (expired with active successor → hidden; expired alone → shown).
