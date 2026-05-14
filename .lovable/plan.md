## Audit findings (facts, not assumptions)

### 1. "Only Rajat gets the alert" — actually NOT true
Nothing is hard-coded. `notify-lead-created` queries `user_roles WHERE role IN ('owner','admin')` and joins `profiles.phone`. The DB shows:

| Name | Phone | Roles |
|---|---|---|
| Yogita Lekhari | +919928910901 | admin |
| Rajat Lekhari | +919887601200 | admin, owner |

`communication_logs` confirms BOTH numbers received every recent lead alert (Rakesh and Chirag). So Yogita is being sent the WhatsApp — likely it's landing on a number she doesn't actively check, or the device isn't logged into WhatsApp Business with that number. Worth verifying on her device before assuming the code is broken.

### 2. Duplicate alerts — real bug
Logs show 2 sends per recipient within ~1 second:
- 15:16:25 + 15:16:26 → Rakesh (Rajat)
- 15:16:29 + 15:16:31 → Rakesh (Yogita)

Root cause: two writers race to call `notify-lead-created` for the same lead.

```text
INSERT INTO leads
   ├─ DB trigger trg_notify_lead_created (pg_net async)  ──► notify-lead-created  (run A)
   └─ Edge fn (capture-lead / webhook-lead-capture /                              
        whatsapp-webhook / ai-agent-brain) does fire-and-forget fetch ──► notify-lead-created (run B)
```

Both A and B read `notified_at IS NULL` BEFORE either has set it, so the idempotency guard fails. The `UPDATE leads SET notified_at = now()` only happens AFTER all sends complete, which is way too late.

### 3. The "two in-app notifications" (New WhatsApp Lead + New Lead Captured)
Those are two **different** notification rows, not duplicates — one is emitted by the WhatsApp AI flow ("New WhatsApp Lead"), the other by the generic lead-created notifier ("New Lead Captured"). They fire in parallel. Confirm with the user whether they want these merged into a single in-app entry.

---

## Plan

### A. Per-admin opt-in toggles ("admin toggle controls")
Add a section in `LeadNotificationSettings.tsx` listing every owner/admin user with:
- Name, masked phone
- A `Switch` per channel (WhatsApp / SMS) per admin

Storage: new table `lead_notification_admin_optouts` (or simpler: a JSONB `disabled_admin_ids` column on `lead_notification_rules`). I'll go with a clean dedicated table:

```sql
CREATE TABLE lead_notification_admin_prefs (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  whatsapp_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now()
);
```
RLS: owners/admins can read all rows; each user can update their own row; owners can update anyone's.

`notify-lead-created` joins this table when expanding the admin recipient list and skips users with the relevant channel disabled. Same logic for managers (managers stay enabled by default; we keep this scoped to the admin list as you asked).

### B. Fix duplicate sends (atomic claim)
Replace the "read then update" pattern in `notify-lead-created` with an atomic claim at the top:

```ts
const { data: claimed } = await supabase
  .from('leads')
  .update({ notified_at: new Date().toISOString() })
  .eq('id', lead_id)
  .is('notified_at', null)
  .select('id, full_name, phone, email, source, branch_id')
  .maybeSingle();

if (!claimed) {
  return json({ success: true, skipped: true, reason: 'already_claimed' });
}
```

Whichever caller wins the `UPDATE … WHERE notified_at IS NULL` proceeds; the loser exits immediately. No more double sends regardless of how many places trigger the function. Remove the now-redundant `notified_at` write at the bottom.

### C. Files touched
1. `supabase/migrations/<new>.sql` — create `lead_notification_admin_prefs` + RLS
2. `supabase/functions/notify-lead-created/index.ts` — atomic claim + filter admins by prefs
3. `src/components/settings/LeadNotificationSettings.tsx` — new "Admin recipients" panel with per-admin toggles

No changes needed in `whatsapp-webhook`, `capture-lead`, `webhook-lead-capture`, or the DB trigger — they keep firing, but the atomic claim ensures only one wins.

### Open question (please confirm before I build)
The two in-app notifications ("New WhatsApp Lead" + "New Lead Captured") — do you want me to suppress the generic one when the WhatsApp AI version already fired for the same lead? It's a separate code path from the WhatsApp duplicate above.
