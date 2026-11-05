# One pricing playbook for Website Chat and WhatsApp

## What exists today
- Plan prices live in the plan list: original price plus offer price (Quarterly ₹13,900 → ₹12,000, Half-Yearly ₹19,999 → ₹18,000, Annual ₹42,900 → ₹36,900, Founder's Pass ₹28,900 → ₹25,000).
- Website chat currently lists every plan's offer price at once and never shows the original price.
- WhatsApp still refuses to share any price with new enquiries and sends them to a club visit instead.
- Neither chat can send a payment link to a new enquiry. WhatsApp only sends links to existing members.
- Add-on prices (sauna, cold plunge, 3D posture scan) live in the benefit packages list, which is for members.

## The new rules (both chats, same behaviour)
1. **Only the plan they asked about.** The chat never lists all plans. If the visitor hasn't picked one, it asks which length they want (Monthly, Quarterly, Half-Yearly, Annual).
2. **Original price first.** The chat quotes that plan's original price and what's included.
3. **Offer price on discount or bargaining.** The first time someone asks for a discount or pushes back on price, the chat reveals the offer price from the plan list. It then makes the case for the value at that price.
4. **Annual floor is ₹25,000.** If they keep bargaining on an annual plan, the chat's last offer is the Founder's Pass at ₹25,000, read live from the plan list. It includes free steam access and the yoga, Pilates and group classes. The chat doesn't reveal any other details.
5. **No discount below the offer price.** Any further bargaining gets: "This is our best price. For anything further, please call the front desk on 8298293003."
6. **No other promises.** Free days, freeze or unfreeze, group or couple deals, extra months, custom offers or anything not on the plan list all go straight to "Please contact the front desk on 8298293003." The chat never invents an offer.
7. **Add-ons are members-only.** A new tool reads sauna, cold plunge and 3D posture scan prices, but only for a verified member. Outsiders who ask get: "Add-on rates for non-members are different. Please call the front desk on 8298293003."
8. **Payment link only after a clear yes.** When a visitor shows interest, the chat confirms the exact plan and price ("Annual Plan at ₹36,900. Shall I send the payment link?"). It creates the link only after an explicit yes, then sends it in the same chat. On the website the link shows in the chat. On WhatsApp it arrives as a message. The desk is alerted to every link.

## Safety and control
- **On/off switches:** one each for price sharing, the payment link, and add-on prices for members. The existing website price switch is reused. If a switch is off, the chat goes back to inviting a visit.
- **Audit trail:** every quoted price, offer reveal, floor offer, payment link and front-desk handoff is logged against the lead with time and channel.
- **Leak guard:** both chats block any amount in a reply that doesn't match the plan list. That stops made-up numbers.
- **No double links:** one live link per lead per plan. Asking again re-sends the same link. The existing payment webhook confirms payment, and a repeated payment notice can't activate twice.

## Technical details
- New shared module `_shared/salesPricing.ts` (single source for both channels): `quotePlan(planId, stage)` where stage is `original` → `offer` → `floor` → `desk`. The negotiation stage is stored in chat state, in website chat state and WhatsApp chat settings metadata. Floor = the active annual plan with the lowest `discounted_price`, never hard-coded.
- New tools `get_plan_quote` and `get_member_addon_prices` in `ai-tools.ts`/`ai-tool-executor.ts`. The add-on tool refuses unless identity resolves to an active member. Website chat calls the same functions through the `capture-lead` chat action.
- Website: `websiteConcierge.ts` drops the "all rates" list in favour of staged quotes. New regexes cover freeze, free days, extra months and custom offers, all routed to the desk.
- WhatsApp: in `ai-agent-brain.ts`, replace the lead pricing blackout (`visitPivotReply` on price questions) with the staged quote. `PRICING_LEAK_RE` is narrowed so it only blocks amounts not in the plan list. Update the `ai_knowledge` pricing and behaviour rows to match.
- Payment link: new `create_lead_plan_link` action. It creates a pending invoice for the lead's plan at the quoted stage price through the existing Razorpay link flow, keyed so it can't run twice (lead + plan + price), and notifies the desk via `dispatchCommunication`. Membership activation stays in the existing confirmed-payment path.
- Migration: three settings switches, a `sales_quote_events` audit table (staff-read only, server inserts only), and a unique key for one live link per lead and plan.
- Analytics events: `price_quoted`, `offer_revealed`, `floor_offered`, `desk_handoff`, `payment_link_sent`.
- Tests (mock only): one plan per reply; original → offer → floor → desk order; no amount below the floor; freeze, free days and group requests go to the desk; add-ons shown to members only; no link without a yes; asking again gives the same link; WhatsApp and website give identical answers.
- Memory: update the pricing rules in project memory, which currently say the AI never quotes prices.

## Assumption to confirm
- Your message said 829829003. I'll use **8298293003**, the number already used across the chat.
