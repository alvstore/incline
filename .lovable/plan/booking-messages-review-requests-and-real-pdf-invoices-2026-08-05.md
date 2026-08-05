# Booking messages, review requests, and real PDF invoices

Three confirmed issues, all in the WhatsApp/Email delivery layer.

---

## 1. Ice bath booking sent a "class" message with blank details

**What happened:** Rehan's ice bath confirmation was sent as
`Hi Rehan khan, your booking for the class on at is confirmed...`

**Confirmed cause:** the booking notifier sends every facility booking under the
category `class_notification` without naming the specific event. The dispatcher
then auto-picked an approved *class* template (`member_class_confirmed`), whose
slots are `class_name / class_date / class_time`. The booking only supplies
`benefit_name / slot_date / slot_time`, so all three slots rendered empty —
hence "for the class on at". The delivery record confirms it
(`auto_resolved_template: true`).

**Fix — one universal session template for every facility:**

- Booking notifications will declare their exact event
  (`facility_slot_booked`, `facility_slot_cancelled`, `facility_slot_reminder`)
  so the dispatcher stops guessing and never falls back to a class template.
- Create three universal, benefit-agnostic templates that work for ice bath,
  sauna, steam, body scan, recovery lounge and any future facility, e.g.:
  > Hi {{member_name}}, your {{benefit_name}} session at {{branch_name}} is
  > confirmed for {{slot_date}} at {{slot_time}}. {{cancellation_policy}}
- Submit them to WhatsApp for approval and register them against the booking
  events, with email and SMS copies of the same wording.
- Add a safety net: if a template still ends up with an empty date/time/name
  slot, the send is blocked and logged instead of going out half-written.

---

## 2. Gentle Google review request

Today the review request is sent as plain free text with the branch Google link.
That works only if the member messaged us in the last 24 hours; otherwise
WhatsApp silently blocks it, because no approved review template exists.

**Fix:**

- Add approved WhatsApp, Email and SMS templates for review requests — warm,
  humble, never pushy, and never implying a rating. Draft body:
  > Hi {{member_name}}, it was lovely having you at {{branch_name}} 🙏
  > If your experience felt worth it, a short Google review would genuinely
  > help our small team grow. It takes under a minute: {{review_link}}
  > No pressure at all — and if anything fell short, just reply here and
  > we'll fix it.
- The link stays the existing tracked redirect, so click-through and
  review-conversion stats keep working.
- Requests continue to respect do-not-contact, quiet hours and dedupe (one
  member is never asked twice for the same visit).

---

## 3. Invoice must arrive as an attached PDF, not a long backend link

**Confirmed cause:** the app *does* generate the PDF and pass it as an
attachment. But the approved WhatsApp template it lands on
(`invoice_generated_pdf`) has **no document header on WhatsApp's side** — it is
body-only. When that happens, the system falls back to pasting the raw signed
storage URL into the message. That is exactly the wall of text in the
screenshot.

**Fix:**

- Create and submit new WhatsApp templates that carry a real **document header**
  (invoice, receipt, and a universal document variant for plans/reports). The
  template-management function already supports uploading the sample file
  WhatsApp requires at approval time.
- Once approved, the PDF is delivered as a native attachment the member can tap
  and open — no visible link.
- Keep the current link-in-body version as an automatic fallback only if the
  document template is unavailable, and shorten that fallback to a clean
  branded link instead of the raw signed URL.
- Email already attaches the PDF; the body copy will be cleaned up to match.
- Fix two related copy bugs seen in past sends: doubled currency symbol
  (`₹₹2,000`) and blank invoice number / due date.

---

## Technical notes

- `supabase/functions/notify-booking-event/index.ts`: pass
  `variables.event_key = <event name>` and switch category to a
  facility-specific one so `CATEGORY_TO_TRIGGER_EVENTS` can't map to
  `class_booked`.
- `supabase/functions/dispatch-communication/index.ts`: extend the empty-slot
  pre-flight block (currently MARKETING-only) to utility templates for
  date/time/name-like keys; add benefit→class variable aliases as a safety net.
- New rows in `templates` with `trigger_event` =
  `facility_slot_booked | facility_slot_cancelled | facility_slot_reminder |
  review_request`, plus document-header variants for
  `invoice_generated | payment_received | universal_document`.
- Meta submission via `manage-whatsapp-templates` (v2.4.0 already resolves
  `h:` sample handles for media headers).
- Sample PDF/asset for header approval will be uploaded to public storage.
- No schema changes to invoices, bookings or feedback.

## Out of scope

- Redesigning the Feedback dashboard.
- Changing invoice amounts, GST or payment logic.
- WhatsApp approval turnaround is on Meta's side; until each template is
  approved the existing fallback copy keeps sending.
