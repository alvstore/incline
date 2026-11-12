# WhatsApp: treat member feedback/complaints as manager escalations

## What went wrong
Advit sent a complaint about the off-hours trainer. The member WhatsApp menu routes by keywords, and his message contained "yoga room", so the bot treated it as "Book a class" and sent the class list. No task was created and no manager was told. ("trainer" would also have sent him to the trainer menu.)

## What will change
1. **Spot complaints before keyword routing.** Before the menu keywords are checked, the bot looks for feedback or complaints. It treats a message as one if it is long and free-form (around 12+ words) or uses complaint words in English, Hinglish or Hindi, such as feedback, complaint, disappointed, rude, helpless, not happy, bekar, ganda or shikayat. Short menu-style messages ("yoga", "book a class", "my trainer") keep working exactly as today. Menu button taps are still checked first, so they're unaffected.
2. **Escalate to the manager.**
   - Creates an **urgent** task titled "Member feedback: <name>" with a 1-hour deadline. It holds the member's full message, phone number and member code.
   - The task goes to the **branch manager**. It never goes to the member's assigned trainer, because the trainer may be the person the complaint is about.
   - Sends an in-app alert to the branch's managers, owners and admins. It goes out through the normal notification route, so it also arrives as a web push on their phones. The lock screen shows only a generic "Member feedback received" with no names.
   - Marks the chat unread and pauses the bot for 4 hours so a person can reply without the bot interrupting.
3. **Calm, proper reply to the member** (no menu, no class list):
   "Thank you for telling us this, Advit — we're sorry your experience fell short. I've escalated it directly to our branch manager, who will personally look into it and get back to you shortly. Your feedback stays confidential."

## Technical details
- `supabase/functions/_shared/whatsapp-member-menu.ts`:
  - Add `FEEDBACK_RE` and an `isFeedback(raw, n)` check (word count ≥ 12, or the vocabulary regex) inside `runMemberGateway`. It runs after the exact sub-menu, slot and class-tap matching and before the `pick` keyword chain.
  - Add `handleFeedbackEscalation()`. It reuses the `tasks` insert pattern with `priority:'urgent'` (falling back to 'high' if the enum lacks it), `sla_hours:1` and `assigned_to` = the branch manager resolved via `branch_managers`/`employees`. It upserts `whatsapp_chat_settings` (bot paused for 4h, `handoff_reason:'member_feedback'`, `is_unread:true`) and creates notifications through the existing dispatcher/notification path, so `enqueue_web_push` fans out to the team.
  - The existing task-SLA notifications stay in place.
- Add a small Deno test: the complaint text escalates, while "yoga", "book a class" and "my trainer" still route to their menus.
- Redeploy `whatsapp-webhook`.
- Verify the urgent priority value and the manager lookup against the live schema before writing.
