# Unify Campaign Counters and Retry Failed Recipients

## Scope
- Make campaign cards and the delivery drawer use one reusable, provider-aware counter model.
- Keep `campaign_recipients` as the authoritative recipient state and refresh the stored campaign totals through the existing reconciler.
- Add realtime invalidation for campaign, recipient, and communication-log changes, with polling as a fallback.
- Make **Reconcile now** await the backend result, then explicitly refetch all three query sets before showing success.
- Retry only the failed recipients for **Yoga Class · WHATSAPP**, excluding permanent/terminal Meta failures, then monitor and reconcile until outcomes settle.

## Implementation
1. Extract reusable recipient status normalization, cumulative counter derivation, and filter matching into a campaign-status utility.
2. Update the drawer to use the shared utility and to invalidate/refetch recipient, log, and campaign queries after every operation.
3. Update cards from the same canonical stored counters, add realtime invalidation, and ensure the open drawer receives the latest campaign row instead of a stale object snapshot.
4. Harden reconciliation response handling so backend `{ ok: false }` or reconciliation errors cannot produce a false “Stats refreshed” toast.
5. Deploy any changed campaign/webhook functions, trigger the existing failed-recipient retry path, and inspect provider receipts and final database counts.

## Safety
- No re-trigger to the full 143-person audience.
- No retry of terminal Meta errors such as invalid/undeliverable recipients.
- Preserve existing campaign delivery, WhatsApp templates, DNC, pacing, and retry architecture.
