# Campaign Wizard 2026 — Multi-channel, Class-aware, Channel-correct

## What's broken today (verified in code + data)

1. **Email shows WhatsApp content.** Two evergreen bases exist for Event campaigns: a WhatsApp one (`class_announcement_poster`, positional `{{1}}…{{4}}`) and an Email one (`Class Announcement (Email)`, named `{{class_name}}`, `{{class_when}}`, `{{poster_url}}`). When you switch the channel to Email, the wizard marks the channel/type combo as "already applied" while the email template is still loading, so the WhatsApp body and its banner stay on screen. Result: Meta positional slots and the "WhatsApp rejects blank slots" warning appear on an Email campaign.
2. **Only one channel per campaign.** Channel is a single choice; there is no way to send the same announcement over WhatsApp + Email together.
3. **Event step is fully manual.** Classes already created in the app are never offered; name/date/time/venue are typed by hand, so email placeholders (`{{class_name}}`, `{{class_when}}`) are never auto-filled.
4. **One generic preview.** The preview is a plain text block for every channel — no email subject/HTML rendering, no WhatsApp bubble, no poster/attachment rendering.

## What will be built

### 1. Channel correctness
- Evergreen auto-apply waits for the query for the *current* channel to finish before deciding; switching channel re-applies the matching base (WhatsApp body for WhatsApp, HTML body + subject for Email).
- Positional-slot UI, "template_param_empty" warnings, Meta template picker, and "Submit template to Meta" only render for WhatsApp. Email/SMS use named variables only.

### 2. Multi-channel selection
- Channel becomes a multi-select (WhatsApp · Email · SMS · RCS) with one primary channel driving per-channel content.
- Each selected channel keeps its own body (and Email keeps its subject), auto-seeded from that channel's evergreen base.
- On send/schedule, one campaign row per channel is created and linked by a shared group id, so existing send, reporting and retry pipelines stay unchanged. The campaign list groups them under one name.

### 3. Class auto-fetch for Event / Class campaigns
- The Event step gets a "Pick a class" selector listing upcoming classes for the branch (name, trainer, date, time, room).
- Choosing a class fills event name, date, time and venue, and exposes `{{class_name}}`, `{{class_when}}`, `{{class_trainer}}`, `{{class_venue}}` as auto-resolved variables in every channel's body — including auto-filling WhatsApp slots `{{2}}`/`{{3}}` so the empty-slot error disappears.
- Manual entry stays available for events that aren't a scheduled class.

### 4. Channel-accurate previews
- WhatsApp: chat-bubble preview with header media and template slot values resolved.
- Email: subject line + rendered HTML preview (poster image included).
- SMS/RCS: plain text with character/segment count.
- Test send fires per selected channel with the correct recipient field (email vs phone).

### 5. Validation before send
- Per-channel readiness checklist: missing subject, unfilled slots, cold-audience template requirement, missing poster for image-header templates — each shown against the channel it blocks, instead of one global WhatsApp-flavoured warning.

## Technical notes

- All work is in `src/components/campaigns/CampaignWizard.tsx` plus a small `useUpcomingClasses` query hook against `classes` (branch-scoped, TanStack Query).
- Per-channel state moves from flat `message`/`subject` to a `Record<channel, { message; subject; templateId; varOverrides }>` map; existing save/send payload builders are called once per channel.
- No schema change: multi-channel is N campaign rows sharing a `campaign_group_id` in `campaigns.metadata`.
- Evergreen bases are read as-is; if an Email evergreen is missing for a type, the wizard falls back to a plain body rather than borrowing the WhatsApp one.

## Verification

Log into the app as the owner in a headless browser, create an Event campaign for members + trainers over WhatsApp and Email, pick a real class, and confirm: correct body per channel, no positional-slot errors on Email, both previews render, and a test send to each channel succeeds. Any errors found in that run get fixed in the same pass.
