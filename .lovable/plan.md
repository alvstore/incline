# Diwali / Khekra schedule — WhatsApp template + campaign

## What I found
- `gym_closure_notice` exists and is approved, but Meta has it as **Marketing**, not Utility. Marketing messages cost more and can arrive late or be filtered.
- Its wording ("temporarily closed from X until Y") doesn't fit your message, which has three days: open until 8 PM, closed, then resume.
- Recipients: about 195 active members, plus 7 staff and 7 trainers.

## What I'll build

### 1. New reusable Utility template, no banner: `club_schedule_update`
Meta usually turns greetings ("Happy Diwali", "wishing you…") into Marketing. To keep this one Utility, the template carries only the schedule facts:

```text
Dear {{1}},

Please note the updated Incline club schedule for {{2}}:

- {{3}}
- {{4}}
- {{5}}

For any help, please contact the front desk on 8298293003.

Team Incline
Rise. Reflect. Repeat.
```

For this send:
- {{1}} = first name
- {{2}} = "Diwali and Khekra"
- {{3}} = "Sun 8 Nov 2026 (Diwali): Open until 8:00 PM"
- {{4}} = "Mon 9 Nov 2026 (Khekra): Closed"
- {{5}} = "Tue 10 Nov 2026: Regular hours resume from 6:00 AM"

You can reuse it for any future holiday or timing change.

### 2. Submit to Meta
- Save the template in the Templates Hub and submit it through the existing WhatsApp connection.
- Meta review usually takes minutes to a few hours. The campaign can only go out once Meta approves it.

### 3. Campaign "Diwali & Khekra Schedule 2026"
- Channel: WhatsApp. Audience: all active members plus active staff and trainers, with no duplicate phone numbers. Anyone marked "do not contact" is left out.
- Variables are filled per person; {{1}} is their first name.
- Created as a **draft / scheduled** campaign, ready for you to press Send once the template is approved. Nothing goes out automatically without your go-ahead.

## Your full greeting text
A greeting-style message can't go out as Utility. Two options:
- **Keep Utility (default):** send the schedule-only template above. It arrives instantly and costs less, but without the festive wishes.
- **Use Marketing:** I also create `diwali_wishes_2026` (Marketing) with your exact greeting text and send that instead. Delivery may be slower and it costs more per message.

Tell me if you want the Marketing version too.

## Technical details
- Insert into `whatsapp_templates` (category UTILITY, header none, example body_text for 5 vars) and push via the existing Meta template-create path/edge function. Then sync to read the approval status.
- Create the `campaigns` row (status draft/scheduled, channel whatsapp, template name, variable map) with an audience of active members ∪ employees ∪ trainers, resolved through the existing `resolve_campaign_audience` / segment path. Delivery goes through send-broadcast → dispatch-communication only.
- No live sends during build. The only external call is template submission to Meta.
