# Fix: wrong WhatsApp variables, Instagram tasks, and AI identity blindness

## 1. "₹Jhony house of optics" — name rendered into every template slot

Verified: the reminder log stored the correct values (`amount_due: 14000`), but the
message text saved and shown in the CRM reads the member name in both slots. The same
symptom appears on the diet and workout PDF messages ("your plan Jhony house of optics
from Jhony house of optics").

Cause: when the dispatcher renders the readable copy of an approved WhatsApp template,
positional placeholders (`{{1}}`, `{{2}}`, …) are looked up by their literal name. That
lookup never matches, so every slot silently falls back to slot 1 — which is the
recipient's name.

Fix: map each positional placeholder to its own slot index and resolve it through the
semantic key already derived for that slot (name → slot 1, amount → slot 2, and so on).
Non-positional `{{amount_due}}`-style placeholders keep working as today.

Verification: re-render the overdue reminder, the diet PDF message, and the workout PDF
message for a test contact and confirm the amount and plan name appear in the right slots.

## 2. Instagram inbound messages should not create tasks

The "Unanswered instagram message" tasks come from the AI lead-loss monitor, which treats
every platform the same. Most Instagram senders are existing members, so these tasks are
noise.

Fix: skip task creation (and the holding-line nudge) for Instagram and Messenger; keep the
behaviour for WhatsApp only. Existing open Instagram tasks are left alone — they can be
bulk-cancelled from the Tasks page.

## 3. AI must recognise trainers, staff, owners and admins

Today the concierge resolves only members and leads. A trainer messaging from a known
number (Lokendra) is treated as a new lead, so the bot asks for name, email and fitness
goal.

Fix: before falling back to lead capture, look the sender up across the whole directory —
member, trainer, employee, and any profile carrying an owner/admin/manager/staff role —
using phone variants and, when available, the email already on record. When the sender is
internal:

- mark the conversation as internal team and skip the lead-capture funnel entirely
  (no name/email/goal questions, no lead row created),
- give the model a short internal-team context line (role, branch) so replies are
  colleague-to-colleague, and
- keep the human-handoff path unchanged.

Verification: send a test inbound from a trainer number and from a member number; confirm
no onboarding questions for the trainer and no new lead row.

## 4. Email sending path

Email already sends through the configured provider with the Hostinger SMTP fallback in
`send-email`. No change unless you want the fallback order flipped — tell me and I'll
include it.

## Technical notes

- `supabase/functions/dispatch-communication/index.ts` — positional slot resolution in the
  template mirror renderer (bump to v1.33.0), then redeploy.
- `supabase/functions/monitor-ai-lead-loss/index.ts` — platform guard before task/holding
  line creation.
- `supabase/functions/_shared/ai-agent-brain.ts` — extend `resolveMemberContext` with a
  staff/trainer/owner lookup and an `isStaff` result flag; gate `shouldCaptureLead` and the
  prompt context on it.
- Knowledge base entry to be added: identity resolution must scan members, trainers,
  employees and privileged profiles before treating an inbound contact as a lead.
