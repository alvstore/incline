## Audit findings

### 1. "Meta Approved" tab is redundant
The sub-tab only hosts two actions: **Test Connection** and **Sync from Meta** (`MetaTemplatesPanel.tsx`, 300 lines, mostly status display). Everything else it shows (per-template Approved/Pending/Rejected) is already visible on the **CRM Templates** tab via the status chips and per-row badge.

**Fix:** Drop the `Meta Approved` sub-tab. Move the two buttons (`Test Connection`, `Sync from Meta` + the "Last synced" timestamp) into the status-filter row on the CRM Templates tab, right of the `Draft` chip. The full diagnostic panel (WABA ID, errors, deletion hint) collapses into a small "Meta connection" popover behind a `Settings` icon next to those buttons — keeps it 1-click but out of the way.

### 2. Why "All = 95" when there aren't 95 WhatsApp templates
DB reality (just queried):

| type | status | count |
|---|---|---|
| whatsapp | approved | 49 |
| whatsapp | pending | 9 |
| whatsapp | draft | 8 |
| email | n/a | 22 |
| sms | n/a | 7 |
| **total** | | **95** |

The chips are scoped to WhatsApp (`approved 49`, `pending 9`, `rejected 0`, `draft 8` — sum 66), but the **All** chip counts the whole `templates` array including SMS + Email (95). That's why the math doesn't add up (49+9+0+8 ≠ 95). UI also shows `Approved 48` while DB has 49 — one approved row is missing `meta_template_status='APPROVED'` even though `approval_status='approved'`, so the count code disagrees with the filter code.

**Fix in `TemplateManager.tsx` (lines 604–615):**
- Compute `statusCounts` only over `templates.filter(t => t.type === 'whatsapp')`.
- Make `All` count = sum of the four WhatsApp buckets (so 66 here), not the entire array.
- Use a single source of truth: `approval_status` from `v_template_with_meta_status` for both the chip count and the filter (drop the `meta_template_status` fallback). That eliminates the 48-vs-49 drift.

### 3. My WhatsApp Routing — does the handoff actually fire?

Data: `staff_whatsapp_routing` has 1 row, phone set, `is_available=true`. The edge function `notify-staff-handoff` exists and correctly reads that row and dispatches WhatsApp.

**Callers audited (`rg notify-staff-handoff`):**
- `src/pages/WhatsAppChat.tsx:1721` — fires when a staff member clicks **Take over** in the inbox. **Works.**
- `supabase/functions/register-member/index.ts:510` — fires on new member registration. **Works.**
- `supabase/functions/_shared/ai-runtime.ts` / `ai-dispatcher.ts` / `ai-auto-reply/index.ts` — **no calls. Zero references to handoff / escalation anywhere in the AI brain.**

So the card's copy ("when the AI hands off a chat, we'll ping your personal WhatsApp") is **misleading**. The AI never triggers it — only the manual *Take over* button and new-member registration do. If the AI decides a conversation needs a human, nothing pings the assigned staff.

**Fix:** Two parts.
1. **Wire AI auto-handoff** in `_shared/ai-runtime.ts`: when the agent emits the existing `human_handoff` signal (or low-confidence / escalation tool-call), invoke `notify-staff-handoff` with the conversation id + reason. Dedupe per conversation (don't re-ping within 30 min).
2. **Tighten the UI copy** in `WhatsAppRoutingSettings.tsx` so it accurately lists the three triggers: AI escalation, manual "Take over", and new-member signup.

## Plan

1. **`TemplateManager.tsx`** — scope `statusCounts` & `All` chip to WhatsApp rows only; switch chip + filter both to `approval_status` (single source). Add `Test Connection` + `Sync from Meta` buttons (+ a small "Meta connection" popover for diagnostics) inline with the status chip row, reusing the logic from `MetaTemplatesPanel.tsx`.
2. **`CommunicationTemplatesHub.tsx`** — remove the `meta` sub-tab from the WhatsApp section (lines 92 + matching `<TabsContent value="meta">`).
3. **Delete `MetaTemplatesPanel.tsx`** once its sync/test logic is lifted into a small `<MetaSyncControls />` helper used by `TemplateManager`.
4. **`_shared/ai-runtime.ts`** — on AI handoff/escalation, fire-and-forget `notify-staff-handoff` (admin-client invoke) with 30-min dedupe keyed on `conversation_id`.
5. **`WhatsAppRoutingSettings.tsx`** — replace the description with: *"We'll ping your personal WhatsApp with a deep link to the shared inbox when (1) the AI escalates a chat, (2) a teammate clicks Take over, or (3) a new member registers. Replies still go through the business number — Meta doesn't allow transferring a conversation to a different phone."*
6. Verify: open WhatsApp tab → All count equals WhatsApp-only sum; Sync/Test buttons visible inline; tab list is 4 (CRM/Coverage/Automations/Routing). Trigger a handoff from a test AI conversation → confirm `notify-staff-handoff` log entry + WhatsApp received.

No DB migrations needed.