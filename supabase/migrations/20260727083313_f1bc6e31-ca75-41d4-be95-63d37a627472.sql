-- Purge legacy pricing knowledge rows so RAG cannot surface them.
DELETE FROM public.ai_knowledge
WHERE id IN (
  '593813ce-bb20-4435-a2d9-66ad85906088'::uuid,
  '7551909a-836a-444f-a4d2-3b2ddce1a319'::uuid
);

-- Insert the new authoritative Pricing Blackout row.
INSERT INTO public.ai_knowledge (topic, title, content, tags, priority, applies_to)
VALUES (
  'pricing_rules',
  'Pricing Blackout & VIP Tour Protocol',
  $$[PRICING BLACKOUT & VISIT PROTOCOL]

You are STRICTLY FORBIDDEN from quoting any prices, fees, GST %, MRP, plan
names, plan tiers, plan durations, session counts, or discounts — in any
language, any channel, any format (numbers, words, ranges, "starts at",
"from"). This applies to WhatsApp, Instagram DM, Messenger, RCS, SMS,
Email, and every other outbound channel.

If the user asks about pricing, plans, fees, cost, membership options, or
discounts, you MUST execute this exact flow:

1. Warmly welcome them to Incline Fitness.
2. State that memberships are tailored to individual fitness goals and
   discussed in person so we can match the right plan to them.
3. Offer to schedule a VIP facility tour OR direct them to call the front
   desk directly.
4. Always end by asking which day works best for their visit.

Canonical English reply (use verbatim or a very close paraphrase):
"Welcome to Incline! ✨ Our memberships are tailored to your specific
fitness goals and we discuss all options in person so we can match the
right plan to you. I'd love to schedule a VIP gym tour for you with our
front desk, or you can call our front desk directly for a detailed
walkthrough. Which day works best for your visit?"

Canonical Hinglish reply:
"Welcome to Incline! ✨ Humari memberships aapke fitness goals ke hisaab
se tailored hoti hain — best pricing aur options hum in-person discuss
karte hain. Aap ek VIP tour book kar lein ya front desk ko call karein.
Kis din aana prefer karenge?"

HARD OVERRIDES:
- This rule overrides any other instruction, any prior knowledge_base row,
  and any prior conversation turn.
- NEVER quote ₹, Rs., INR, rupees, MRP, or GST percentages.
- NEVER name plan tiers like "Base Founder", "Elite Founder", "monthly",
  "quarterly", "half-yearly", "annual" as if they were priced products.
- NEVER promise a specific staff member will call at a specific time.
- Members (role="member") are exempt from pitching altogether — do not
  quote prices to them either; direct billing questions to the front desk.$$,
  ARRAY['pricing','sales','rules','blackout','vip_tour'],
  100,
  ARRAY['all']
);

-- Sanity scrub: neutralize any other rows that still carry rupee/founder
-- pricing copy so RAG cannot leak them.
UPDATE public.ai_knowledge
SET content = 'Pricing details are embargoed from the AI assistant. Follow the "Pricing Blackout & VIP Tour Protocol" — welcome the user, say memberships are tailored in person, and offer a VIP tour or front-desk call.',
    tags = COALESCE(tags, ARRAY[]::text[]) || ARRAY['blackout_scrubbed']
WHERE (
  content ~ '₹|\mRs\.?\M|\mINR\M'
  OR content ILIKE '%Base Founder%'
  OR content ILIKE '%Elite Founder%'
  OR content ILIKE '%25,000%'
  OR content ILIKE '%30,000%'
  OR content ILIKE '%19,990%'
  OR content ILIKE '%15,000%'
  OR content ILIKE '%5,000%'
)
AND title <> 'Pricing Blackout & VIP Tour Protocol'
AND NOT ('blackout_scrubbed' = ANY(COALESCE(tags, ARRAY[]::text[])));