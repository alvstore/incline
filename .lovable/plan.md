# Rebuild AI Brain — Shared Knowledge from scratch

## What the audit found
- 67 knowledge notes in total: 59 switched on, 8 switched off (old "never share prices" notes).
- Many active notes contradict today's rules:
  - "Pricing blackout" / "visit-first" sales notes clash with the new playbook (regular price → offer price → final, no further discount → visit or call 8298293003).
  - "Incline has no mobile app" is now wrong (members have the phone app).
  - "Incline is OPEN — Enquiry Onboarding Sequence" and the old conversation-stage notes repeat the old one-question-at-a-time intake.
  - Website notes (`web:` topics) and WhatsApp notes say the same things in different words, so the two channels can drift.
- Overlaps: two persona notes, three sales notes, two recovery notes, separate website and general location/hours notes.

## What I will do
1. Save a full backup of every current note (downloadable file in Files) before touching anything.
2. Permanently delete all 67 notes, including the switched-off ones.
3. Create one clean, shared set of about 20 notes used by both the website chat and WhatsApp:

| Area | Notes |
|---|---|
| Identity | Ananya persona & tone; reply style per channel; never invent |
| Club facts | Location & map link; hours & visit times; training floor & equipment; 100% AC atmosphere; recovery suites + safety; 3D body/posture scan; PT, Pilates, Yoga & classes; official links |
| Sales | Membership lengths offered; pricing playbook (live plan list, regular + offer price, no further discount, humble facilities explanation, visit or call 8298293003); free days/freeze/group/couple → front desk; add-on prices members-only; payment link only after a clear yes; visitors who already visited are not pushed to visit again |
| Leads | Collect name, phone, email, then intent, goal, plan — never re-ask what is known |
| Members & team | Members/trainers/staff skip sales and use the self-service menu or call 8298293003; members can use the phone app and web portal |
| Safety | When to hand off to a human; non-membership enquiries (jobs, vendors) redirected |

4. Each note gets clean tags so the website chat still finds its answers (hours, location, amenities, recovery, assessment, classes, membership, pricing, escalation, unknown) and WhatsApp finds the same notes.
5. Rebuild the search index for the new notes and check the AI Brain settings page lists only the new set.
6. Run the existing website-chat and pricing checks, and replay the Annual ₹28,900 → ₹25,000 conversation.

## What will not change
- No prices are written into notes — amounts always come from the live membership plans.
- The opening date stays undisclosed.

## Technical details
- Backup: export `ai_knowledge` rows to `/mnt/documents/ai_knowledge_backup_2026-11-06.json`.
- Delete all rows, then insert the new rows with `applies_to` `{all, website_chat}` (or `{lead}` / `{member}` where channel-specific), `status='active'`, `source='manual'`, `web:<topic>` tags retained for `websiteConcierge`; `embedding=null` so `embed-knowledge` re-embeds via the existing trigger.
- Verify `match_ai_knowledge` returns rows and `websiteConcierge.test.ts` / `salesPricing.test.ts` pass.
