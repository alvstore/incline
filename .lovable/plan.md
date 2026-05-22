## Live Feed Consolidation — Audit & Plan

### What's wrong today (from your screenshot)
The Live Feed renders one row per `communication_logs` row. The "New Lead: Rajat Lekhari" alert fans out to 3 staff × 3 channels (email/WA/SMS) and we get **8+ near-identical rows** stacked together. Same recipient also gets duplicate rows when an alert is sent on both Email and WhatsApp (e.g. Yogita + Rajat each show Email + WhatsApp as separate lines).

Root cause: `LiveFeed.tsx` maps `filtered.map((log) => row)` 1:1, no grouping. The dispatcher already writes a `dedupe_key` and `content` we can group by.

### Consolidation rule (the audit)
Group rows that share **all** of:
1. **Recipient identity** — `member_id` if present, else normalized phone (for WA/SMS) or lowercase email
2. **Message body fingerprint** — `dedupe_key` if set, else `sha1(subject + content)` truncated
3. **Time bucket** — created within a 10-minute rolling window of each other

Each group renders as **one row**:
- Recipient name + contact (resolved once)
- Single message preview (longest non-empty body wins)
- **Channel chips**: WA · Email · SMS · In-App — each chip colored by channel, with a tiny status dot (sent/delivered/read/failed) derived per-channel from the worst-to-best status of that channel's logs
- Right side: most-recent timestamp + worst-status badge (e.g. if any failed → red "1 failed of 3")
- Expand row → existing `DeliveryTimeline` shown per channel (tabbed or stacked)

Counts in tabs/KPIs stay raw (per-log), so "WA 102 / Email 6" still reflects true volume — only the **rendered list** collapses.

### Files to change
| File | Change |
|---|---|
| `src/components/communications/LiveFeed.tsx` | Add `groupLogs(filtered)` memo producing `Group[]`. Replace `filtered.map(...)` with `groups.map(...)`. New `<GroupRow />` inline component renders channel chip cluster + consolidated status. Expanded view loops each underlying log into `DeliveryTimeline`. Search/channel-filter still operates on raw logs *before* grouping so filtering by WA correctly collapses to WA-only chips. |
| (no DB / no edge fn changes) | Pure UI consolidation — dispatcher, dedupe, retries untouched. |

### Edge cases handled
- Channel filter = WA → groups become single-chip (correct)
- Same person, same body, 3h apart → two separate groups (time bucket)
- Different recipients of the same broadcast → separate groups (recipient identity)
- One channel fails, others delivered → group shows "2 delivered · 1 failed" pill
- Realtime insert: invalidation already in place, grouping re-runs

### Out of scope
- No changes to `dedupe_key` semantics, no schema migration, no edge-function edits
- KPI strip and channel tab counts remain per-log (intentional — ops still need true volume)
- Notification reliability fixes (Meta 131049 etc.) tracked separately

Used the redesign + ui-ux-pro-max skill lenses: anchor on real screen → fix density (8 rows → 3 rows) → preserve information (channel chips + per-channel status) → no new modal, expand-in-place.
