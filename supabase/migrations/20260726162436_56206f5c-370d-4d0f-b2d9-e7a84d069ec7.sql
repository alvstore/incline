
-- Retire pre-launch embargo rows (kept for audit).
UPDATE public.ai_knowledge
   SET is_active = false, status = 'archived', updated_at = now()
 WHERE id IN (
   'c32b84d2-50aa-4c51-9464-f8d3ae8fb33d',
   '7551909a-836a-444f-a4d2-3b2ddce1a319'
 );

-- New SSOT: live pricing matrix + operating hours.
INSERT INTO public.ai_knowledge
  (topic, title, content, priority, is_active, status, applies_to, branch_id)
VALUES (
  'pricing_rules',
  'Pricing Matrix (Post-Launch)',
$$Incline is OPEN — 24×7 at Sector 14, Udaipur. There is NO launch embargo. Prices below are current and may be shared with prospective members. All plan prices are subject to 5% GST (never 18%).

**Annual — Base Founder — ₹25,000** (MRP ₹28,900)
Includes: Gym + Steam. Does NOT include Ice Bath or Infrared Sauna.

**Annual — Elite Founder — ₹30,000** (MRP ₹36,900)
Includes: Gym + Steam + 6× Ice Bath sessions + 6× Infrared Sauna sessions + 6× 3D BMI scans. All 6-packs are usable anytime during the year.

**Short-term plans (Gym + Steam)**
• 1 Month — ₹5,000
• 3 Months — ₹15,000
• 6 Months — ₹19,990

**Mandatory CTA for every pricing turn to leads / unknown contacts:**
After sharing prices, IMMEDIATELY end the message with:
"For better pricing options and a detailed breakdown, I'd love to schedule a VIP gym tour for you with our front desk. Which day works best for you?"

Do NOT end a pricing turn without asking for a preferred visit day.$$,
  1, true, 'active', ARRAY['all']::text[], NULL
),
(
  'sales_protocol',
  'Post-Launch Sales Protocol',
$$OPERATIONAL STATUS: Incline is officially OPEN. Actively converting leads into members.

CONTEXT-AWARE ROUTING (check <user_context> role before replying):

1. **MEMBER MODE** (role="member" or resolved active membership):
   - Do NOT pitch plans or quote plan prices.
   - Focus on support, PT bookings, facility access, class schedules.
   - Do NOT append the VIP tour CTA — they are already members.
   - For add-ons/upgrades, quote from knowledge and offer to connect front desk.

2. **LEAD / UNKNOWN MODE** (role="lead" or role="unknown", or context missing):
   - You MAY share pricing transparently using the "Pricing Matrix (Post-Launch)".
   - You MUST append the VIP tour CTA at the end of any pricing turn.
   - Never end a pricing turn without asking for a preferred visit day.
   - Never invent staff names or specific call times; "our front desk will confirm" is the correct phrasing.$$,
  1, true, 'active', ARRAY['all']::text[], NULL
);
