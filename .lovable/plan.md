# Messaging audit: welcome, PDF delivery, overdue copy, daily 11 PM report, nudges

Findings below are confirmed against the live delivery logs and templates.

---

## 1. Welcome WhatsApp not delivered (Mohit Kumawat, Rajveer Singh, Krishna Sachdev)

Two separate faults, one after the other:

- **First attempt reached Meta and was rejected with error 131049** — "not delivered
  to maintain healthy ecosystem engagement". The template `welcome_incline_fitness`
  resolved correctly, but it is registered with Meta as a **MARKETING** template
  (the log shows `category_drift: true`), so Meta pacing-blocks it for new numbers.
- **The retry then failed differently.** The retry worker re-sends only the plain
  text and drops the variables, so the event key `member_created` is lost, no
  template can be matched, and the message is suppressed with
  `no_template_for_closed_session`. This is why the same message shows twice.
- **Copy bug:** the body reads "Your *Mohit Kumawat* membership is now active"
  because `{{membership_plan}}` is never supplied and gets filled positionally
  with the member name. Also, the plan is not active at registration time.

**Fix**
- Submit a new **UTILITY**-category welcome template with correct wording
  (member code + portal login, no "membership is now active" claim) and use it
  for registration; retire the MARKETING one for this event.
- Make the retry worker carry the original variables and event key so retries
  resolve the same template instead of falling into the suppressed path.
- Never leave a template slot unfilled: any missing variable blocks the send with
  a clear log line instead of silently borrowing the previous value.
- Re-send the welcome message to Mohit, Rajveer and Krishna once approved.

## 2. Diet / invoice PDFs arrive as a link, not an attachment

The approved templates for these events (`diet_plan_ready_doc`,
`invoice_generated_pdf`, `custom_diet_plan_ready_pdf`) are all
`header_type = none`, i.e. body-only. The dispatcher already prefers a
document-header template when one exists, so it degrades to pasting the link.
The separate "attached as a PDF" message is being suppressed outright.

**Fix**
- Create and submit **document-header** WhatsApp templates (diet plan, workout
  plan, invoice, receipt, generic document), uploading the sample file Meta
  requires at approval time so the header handle is valid.
- Point the plan/invoice senders at those templates; the PDF then arrives as a
  tappable attachment.
- Keep the link version as an automatic fallback only, and stop sending the
  duplicate "attached as a PDF" message that currently just gets suppressed.

## 3. Overdue reminder shows "₹" with no amount and no due date

The approved template uses `{{amount_due}}`, `{{item_description}}` and
`{{due_date}}`, but the reminder worker sends `pending_amount` / `total_amount`
instead — so the slots render empty. It also prefixes "₹" to its values while
the template body already prints "₹", which would double the symbol.

**Fix**
- Send the exact variable names the templates expect (`amount_due`,
  `due_date`, `item_description`, `invoice_number`, `payment_link`) with
  symbol-free amounts and a readable date (e.g. 12 Aug 2026).
- Block the send when amount or due date is missing, and log it, instead of
  mailing a blank "₹".

## 4. Daily business summary at 11:00 PM IST to Yogita and Rajat

New scheduled report covering the IST day (00:00–23:00):

- New memberships enrolled today (count + names)
- Total sales invoiced today
- Amount received by mode: Cash / UPI / Card / Bank transfer
- Dues collected today and total outstanding pending

Delivered on WhatsApp to Yogita Lekhari and Rajat Lekhari (email copy as
backup), with the recipient list editable in settings so owners can be added or
removed without a code change. Runs off the existing Automation Brain schedule
and appears in its run history with a Run Now button for testing.

## 5. Retention nudges going to members who still visit

Threshold is currently 3 days, so members who trained on the 4th were nudged on
the 8th. Confirmed correct against the rule, but the rule is too aggressive.

**Fix**
- Move thresholds to **5 / 10 / 21 days** (Value Add / FOMO / Incentive).
- Re-check the member's last visit immediately before each send, so anyone who
  checked in after the batch was picked is dropped.
- Count gate/turnstile entries as visits, not only app check-ins.
- Skip members whose membership starts or ends inside the window, and keep the
  existing 30-day per-stage cooldown.

---

## Technical notes

- `supabase/functions/process-comm-retry-queue/index.ts`: `payloadVariables` is
  hardcoded `undefined`; persist and replay `payload.variables` (incl.
  `event_key`) from the original queue row.
- `supabase/functions/register-member/index.ts`: pass a complete variable set for
  the new UTILITY welcome template; drop the "membership is now active" wording.
- `supabase/functions/send-reminders/index.ts`: rename reminder variables to
  `amount_due` / `due_date` / `item_description`, strip the "₹" prefix, format
  the date; guard on missing values.
- New/updated rows in `public.templates` + Meta submission via
  `manage-whatsapp-templates` for: `member_created` (utility),
  `diet_plan_ready`, `workout_plan_ready`, `invoice_generated`,
  `payment_received` (all `header_type = document`, with sample handle).
- New edge function `daily-business-summary` registered as an
  `automation_rules` row on `automation-brain-tick` at 17:30 UTC; recipients in
  `settings` key `daily_summary_recipients`; all sends via
  `dispatch-communication` with `event_key = daily_business_summary`.
- `retention_templates.days_trigger` updated to 5 / 10 / 21;
  `get_inactive_members` extended to consider `access_logs` entries;
  `run-retention-nudges` re-validates last visit before dispatch.

## Out of scope

- Redesigning the communications log UI.
- Changing invoice, GST or payment calculations.
- Meta approval turnaround is on Meta's side; existing copy keeps sending until
  each new template is approved.
