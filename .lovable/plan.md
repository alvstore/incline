# Global Class Announcement Poster — one template, any class

Goal: upload a new class poster, type two or three details, and send the same announcement to every member plus trainers, managers and owners over WhatsApp and Email — without creating a new Meta template each time.

## The key idea

Meta must approve a template **once**. It cannot approve a new poster every week. So the poster is not part of the approved template — the template is approved with an **IMAGE header slot**, and the actual picture is attached at send time. That is already supported end-to-end in this project (verified): `manage-whatsapp-templates` uploads a sample image to Meta's resumable-upload API for approval, and `dispatch-communication` swaps in the real poster URL on every send.

Result: approve once, reuse forever, new photo each time.

## 1. The reusable template pair

**WhatsApp — `class_announcement_poster`** (category MARKETING, language en)

- Header: IMAGE (the poster)
- Body:

```text
Hi {{first_name}}, {{class_name}} is happening {{class_when}}.
{{class_details}}
Slots are limited — book yours from your Incline dashboard.
See you on the mat.
```

Four variables only, deliberately generic so the same template covers Yoga, Zumba, Pilates, HIIT, workshops and one-off events:

| Variable | Example |
|---|---|
| `first_name` | Rajat |
| `class_name` | Yoga Class |
| `class_when` | tomorrow, 8:30 AM & 6:00 PM |
| `class_details` | First come, first served. Morning and evening batches. |

**Email — `class_announcement_poster__email`**

Same four variables, rendered through the existing branded shell (black + gold, INCLINE header, "The Incline Life by Incline" footer). Poster shown full width at the top, details table below, single gold CTA button to the member dashboard booking page.

## 2. A "Class Announcement" campaign type

Add a fourth type to the campaign wizard next to Promotion / Event / Announcement, so sending is a 4-tap job:

```text
Step 1  Type      → Class Announcement
Step 2  Class     → pick a scheduled class (auto-fills name, date, times)
                    or type it manually
Step 3  Poster    → upload the image (drag & drop, ≤5MB, JPG/PNG)
Step 4  Audience  → "Everyone at the club" (default)
Step 5  Preview   → WhatsApp bubble + email preview with the real poster
                    → Send test to me · Send now · Schedule
```

Picking a class from the schedule fills `class_name`, `class_when` (both batch times merged, e.g. "tomorrow, 8:30 AM & 6:00 PM") and a suggested `class_details` line, all still editable.

## 3. Audience: everyone, in one preset

The audience resolver currently offers members, leads, contacts, staff, or "mixed" — and "mixed" pulls in **leads** too, which should not receive a members-only class notice. Add a `members_and_staff` audience kind (active members + active trainers + active employees with owner/admin/manager/staff roles, de-duplicated by phone) and make it the default for this campaign type. Do-not-contact and quiet-hours rules stay in force, as with every send.

## 4. Rollout sequence (what actually happens)

1. Create the two templates in the Templates Hub; submit the WhatsApp one to Meta using the attached yoga poster as the approval sample.
2. Meta review — typically minutes to a few hours. The Templates Hub shows PENDING → APPROVED; the hub already polls status.
3. Once approved: send a **test to the owner's number and email** from the wizard.
4. Then the live send to the full club audience, with per-recipient delivery tracked in the comms live feed.

Steps 2–4 need a pause for Meta's verdict, so this ships in two passes: build + submit now, verify + test-send once Meta approves.

## 5. Reliability details worth fixing while we're here

- **Poster must be publicly fetchable.** Meta downloads the image from a URL. Campaign attachments must be served from a public-read path (or a long-lived signed URL) or WhatsApp silently drops the header. The wizard will verify the uploaded poster resolves over plain HTTPS before allowing send.
- **Image spec guard.** Warn on upload if the poster is over 5MB or not JPG/PNG, and note that WhatsApp crops to roughly 1.91:1 in the chat preview — the full poster is still visible on tap. The reference poster is a tall 2:3 format, which is fine, but the preview will show the crop so nothing surprises you.
- **Email fallback.** If a member has no WhatsApp-reachable number, the same announcement goes out by email automatically through the existing dispatcher fallback.

## Technical notes

- New template rows in `templates` (`type='whatsapp'`, `header_type='image'`, `trigger_event='class_announcement'`) and (`type='email'`), plus a `whatsapp_triggers` mapping. Submitted via `manage-whatsapp-templates` `action:'create'` with `header_sample_url` set to the uploaded poster.
- `resolve_campaign_audience`: add `audience_kind='members_and_staff'` branch (members with active membership UNION trainers UNION employees), keeping the existing SECURITY DEFINER / branch-scoped shape.
- `CampaignWizard`: new `class_announcement` type pre-step, class picker sourced from `classes`, poster upload reusing the existing creative step, variable auto-fill, and a poster-aware preview panel.
- Send path unchanged: `campaigns.attachment_url/kind` → `send-broadcast` → `dispatch-communication` (already maps `header_type='image'` to a native Meta image header).
- No new edge function, no new bucket.
