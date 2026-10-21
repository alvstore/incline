# Fix: Birthday greeting sends a "PDF" link instead of the birthday video

## What happened
- The Greet button does attach the birthday video.
- But the only **switched-on** WhatsApp birthday template is the old text-only one ("…team at Incline Fitness wishes you…"). It has no video slot.
- The approved video template (`member_birthday_wish_video`) and the photo-card template are both saved but **switched off**.
- When a template has no media slot, the sender pastes the file link into the message text and always labels it "PDF", even for a video. That is why members got "Document.pdf".

## Fix
1. **Use the video template for birthdays:** switch on `member_birthday_wish_video` (already approved by Meta, video already stored) and switch off the old text-only birthday template, for the INCLINE branch. The photo-card template stays off.
2. **Sender safety:**
   - If an approved template with a matching video or image slot exists for the event, the sender prefers it over a text-only one.
   - A video or image is never pasted as a "PDF" link. If no template can carry it, the message goes out without the link instead of a fake document.
   - The link fallback is kept for real documents only, such as invoices and plans.
3. **Check:** send one test greeting to a staff number (or re-greet one of today's birthday members if you agree). Confirm it arrives as a video with the new "The Incline Life by Incline" text.

## Notes
- Birthday templates are MARKETING. Meta may hold some sends (error 131049) if the member got another marketing message recently. That is a Meta limit, not this bug.
- Sumit and Chestav already received today's text message. They are only re-sent if you ask.

## Technical details
- Data change on `templates`: set `is_active = true` for the row with `meta_template_name = 'member_birthday_wish_video'`, and `false` for `member_birthday_wish`, both on branch 1111…, `trigger_event = 'birthday'`.
- `dispatch-communication` (version bump):
  - In event-key template auto-resolution, when `attachment.kind` is video/image, rank templates whose `header_type` matches first.
  - In `appendAttachmentLinkForBodyOnlyTemplate`, skip non-document kinds and label document links as "PDF" only for real documents.
- Redeploy `dispatch-communication`. Verify by checking the new `communication_logs` row (whose resolved template should be the video one) and the delivery status.
