# Member chat (WhatsApp + website): handle every membership status properly

## What the audit found
Chat decides "who you are" mostly from the member's status label, not from their real plan. The results:

- **Expired, frozen, cancelled, unpaid-start and no-plan members** whose label still says "Active" get the full member menu. "Book a class" is offered and then fails. "Membership details" just says "I can't see an active membership". It never says "expired on 20 Oct" or "frozen until…".
- **Suspended and blacklisted members** are kept out of the menu, but the AI then greets them as an "Active Member" and still lets them book classes, open bills and ask for freezes.
- **The AI can book classes without checking the plan.** The menu's booking checks properly; the AI's doesn't, so a member with no plan can get a class through the AI.
- **Resume after freeze through the AI never works.** It can't see frozen plans. Renewal through the AI also fails for expired plans.
- **AI booking of recovery services (sauna, ice bath and so on) fails for everyone** because of a wrong channel label.
- **The member menu has no "Pay dues / My bills", "Renew", or "Freeze / Resume" options.** Typing "renew" just shows membership details.
- **Front-desk requests go to the member's trainer** while the reply says "front desk manager".
- **Website chat** treats anyone with an account (staff, past leads) as a "member". Its member pricing answer can still show public prices first.
- **Members whose app login is switched off** are still fully served in chat.

## Plan

### 1. One "chat access status" for each member (server-side)
A single lookup that works out the member's real state: active, expiring soon, expired, frozen, unpaid start, no plan, suspended or blacklisted (login off counts as blocked). It also returns dues, the plan's end date, the freeze-until date and the last plan. WhatsApp menu, WhatsApp AI and website chat all use it, so they can never disagree.

### 2. What each member sees

| Status | Menu / reply | Allowed | Blocked | Staff task |
|---|---|---|---|---|
| Active | Full menu, plus My bills, Renew, Freeze | Everything | – | Only on request |
| Expiring ≤ 7 days | Full menu with a renew banner | Everything, plus a renewal link | – | – |
| Expired | "Your plan ended on {date}". Options: Renew, Talk to desk, Attendance, My bills | Renewal link (live plan list, sales rules), pay dues | Class/recovery booking, workout/diet | Renewal follow-up task (one per week) |
| Frozen | "Paused until {date}". Options: Request resume, Talk to desk, My bills | Resume request (goes for approval) | Bookings | Resume approval |
| Unpaid start | "Your plan starts once ₹{due} is paid". Options: Pay now, Talk to desk | Payment link | Bookings | Desk follow-up |
| No plan / inactive | Welcome-back message. Options: See plans, Talk to desk | Plan interest, then sales flow (members only, not lead pricing) | Bookings | Front-desk task |
| Suspended / blacklisted / login off | Polite fixed reply: "Please contact the front desk at 8298293003" | Nothing automated | All tools, AI off | One desk alert, no repeat for 24 hours |

All replies follow the same pattern: say what's happening in one line, give the next step, then offer buttons. No AI-invented wording for blocked or expired states.

### 3. Fix the AI
- Pass the real status, plus last plan, end date and dues, instead of "Active Member".
- Hide booking, freeze and renew tools based on status.
- AI class booking goes through the same checked booking step as the menu.
- Resume and renew can find frozen or expired plans.
- Fix the recovery booking channel label.

### 4. Fix the WhatsApp menu
- Add "My bills / Pay dues", "Renew", and "Freeze / Resume". These reuse the existing payment link, approval request and front-desk task steps.
- Route "renew", "dues" and "unfreeze" keywords correctly.
- Front-desk tasks go to the branch's front desk or manager, not the trainer.

### 5. Website chat
- "Already a member" only when there's a real member record. Staff and leads with accounts go through the normal flow.
- Member pricing replies never show public prices; they point to Renew on WhatsApp or the desk.
- Blocked members get the same desk-only message.

### 6. Safety and roll-out
- Per-branch on/off switch (`member_chat_status_v2`, on by default) so you can go back to today's behaviour.
- Tests for every row of the table above (allowed/blocked actions per status).
- After release, check by sending messages from test numbers in each status.

## Technical section
- New database function `member_chat_status(p_member_id)`: reads memberships (all statuses), dues from pending/partial/overdue invoices, `members.status`, `login_disabled_at`. Callable only from backend functions.
- `_shared/memberChatPolicy.ts`: pure status → allowed tools / menu / reply-template map, unit-tested with bun.
- `_shared/whatsapp-member-menu.ts`: identity no longer requires `status='active'`; it calls the policy; new handlers; trainer-assignment fix.
- `_shared/ai-agent-brain.ts`: status context and tool filter. `_shared/ai-tool-executor.ts`: class booking via the `book_class` RPC; resolve frozen/expired plans for resume/renew; `membership_plans` price lookup; facility source `whatsapp_ai`.
- `_shared/websiteLeadCapture.ts` (member check via `members`), `_shared/websiteConcierge.ts` (member pricing branch), `WebsiteLeadChatbot.tsx` (blocked handoff copy).
- All messages go through `dispatch-communication`; errors go through `log_error_event`; function version bumps; redeploy whatsapp-webhook, meta-webhook, capture-lead.

## Decisions to confirm (defaults used above)
- Suspended/blacklisted: desk-only reply (not silence).
- Expired members get a renewal link straight away, using the sales pricing rules.
- Weekly cap on renewal follow-up tasks per expired member.
