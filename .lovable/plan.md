# One campaign creator: keep "Create Marketing Campaign", remove "New message"

## Goal
Remove the basic "New message" drawer everywhere. The original **Create Marketing Campaign** drawer becomes the only place to write and send messages — then polish it so it is easier to use, without losing any feature.

## 1. Single creator
- Campaigns page, Announcements page and Discount Coupons "broadcast" all open **Create Marketing Campaign** (coupon page pre-fills the message).
- Delete the "New message" drawer and its helper; move its useful rules (In-App audience count, WhatsApp template readiness block) into the old drawer.
- Buttons read **"Create campaign"**.

## 2. Add what the old drawer is missing
- **In-App channel** (bell + browser push + phone app, one path) next to WhatsApp, SMS, Email, RCS.
- Live recipient count per channel ("195 with the app, 206 with WhatsApp, 180 with email").
- WhatsApp: shows template approval status and blocks sending until approved (no silent failures).
- Scheduled In-App sends also notify the bell/push at the scheduled time (currently only "Send now" does).

## 3. Improve the experience (ui-ux-pro-max guidance, existing colours/fonts kept)
- Clear 5-step top bar that fits mobile: **Type → Audience → Message → Event (only for events) → Review & send**; completed steps clickable to go back.
- Type step: four large cards (Promotion, Event, Announcement, Lead re-engagement) with one-line explanation.
- Audience step: segment chips + live count + "preview 5 recipients".
- Message step: channel toggles as cards; one message box with per-channel tabs only when the user wants different text; live phone-style preview for WhatsApp/SMS/Email/In-App; "Draft with AI" and attachment upload kept.
- Review step: summary card (who, which channels, when, attachments, warnings) with Send now / Schedule.
- Sticky footer with Back / Next; Next disabled with a short reason when something is missing.
- Drawer split into smaller pieces internally so it stays maintainable (behaviour unchanged).

## 4. Checks
- Update tests for composer rules (audience counts, WhatsApp block, In-App channel) and run them.
- Browser walkthrough on desktop and mobile: create a draft campaign with each type; nothing actually sent.

## Technical notes
- `CampaignWizard.tsx` (2.2k lines) is split into step components under `src/components/campaigns/wizard/`; `MessageComposerSheet.tsx` removed; rules in `src/lib/campaigns/composer.ts` reused by the wizard.
- In-App sends go through `dispatchCommunication` (existing single path); scheduled In-App fan-out handled by the existing campaign sender when the schedule fires.
- AGENTS.md rule about `MessageComposerSheet` replaced with "CampaignWizard is the only composer".
