# Voice AI queue names + compact Integrations header

Two changes, both presentation-layer plus one read-only backend addition. No calling, eligibility, DND or cooldown logic is duplicated or altered.

## 1. Today's queue shows real members

Today the queue tab only shows three counters, because the backend eligibility function (`voice_retention_eligibility`) returns a JSON summary and no member rows. Call history already shows member name and last visit; the queue does not.

Fix at the source, not in the browser:

- Split the existing eligibility predicate into a row-returning read function `voice_retention_queue(p_branch, p_limit, p_offset)` that applies the **exact same** filters already in `voice_retention_eligibility` (active branch/member/membership, minimum absent days, cooldown, DND/pause, calling window, daily cap ordering). The existing summary function is then rewritten to count from that same source, so there is one predicate and no drift.
- Returned per member: member name, member code, masked phone, last visit date, days absent, plan name, plan expiry, assigned trainer, last call outcome and last call date, plus `eligible_at`.
- Same guard rails as the other Voice AI read RPCs: `SECURITY DEFINER`, `set search_path = public`, `auth.uid()` + role check, branch restricted to `user_visible_branch_ids`, phone masked, bounded pagination, `anon`/`PUBLIC` execute revoked.
- Queue tab renders a table (Member · Member code · Last visit · Days absent · Plan expiry · Trainer · Last outcome) with skeleton, empty and error states, the existing counters kept above it, and the existing "backend decides eligibility" notice retained. Rows open the existing call detail sheet when a prior call exists. Still **no dial button** and retention automation stays off.

## 2. Integrations header: compact + Voice AI tile

The summary strip currently has six large `StatCard` tiles wrapping onto two rows, and Voice AI is missing even though it has its own tab.

- Add a seventh tile, **Voice AI**, sourced from the existing `voice_ops_summary` RPC (agent configured + active), using the `PhoneCall` icon, success variant when active.
- Replace the tall tiles with a compact single-row strip: one horizontal scroll-free grid (`grid-cols-2 sm:grid-cols-4 xl:grid-cols-7`), each tile reduced to icon badge + label + count on one line, `rounded-2xl`, soft shadow, hover lift — same token set as the rest of the app, roughly half the current vertical height.
- Each tile becomes a button that switches to its matching tab, with focus ring and `aria-label`; active tab tile gets a primary-tinted state.
- Header text tightened to one line so the tabs sit above the fold.

No changes to Settings → Integrations configuration behaviour, providers, secrets or the Sarvam card itself.

## Technical notes

- New migration: `voice_retention_queue` + rewrite of `voice_retention_eligibility` to share it; grants to `authenticated` only.
- `src/hooks/useVoiceOps.ts` — add `useVoiceQueue` hook and typed row interface (drop the `as any` escape hatch for the new call).
- `src/pages/VoiceAI.tsx` — queue tab table.
- `src/components/settings/IntegrationSettings.tsx` — compact tile strip + Voice AI tile, tile→tab wiring.
- Verify: branch scoping for a manager, no raw phone in payloads, no `context_payload` exposure, typecheck and build clean.
