## Why we're doing this

Right now Ananya's behavior comes from two places:

1. **Database** (`ai_knowledge` + `ai_purposes.guards`) — the editable brain. Already has persona, pricing embargo, tour rules, canonical facts, identity rule, formatting rules.
2. **Hardcoded TypeScript** in `supabase/functions/_shared/ai-agent-brain.ts` — duplicates the non-fitness redirect copy, the plan-interest list (monthly/quarterly/half-yearly/annual), the PT/Velvet-Rope wording, and the opening date.

Result: editing the DB does nothing because the inline strings always win, and the "Embed failed" audit you just ran is hiding the real problem — half the brain is invisible to the AI Brain UI.

Also: `public/llms-full.txt` and `public/llms.txt` still say "22 June 2026" / "June 22, 2026"; you've now told me the real opening is **July 2026**.

---

## Plan

### A. Backfill hardcoded rules into `ai_knowledge` (single migration)

New / updated rows, all `branch_id = NULL`, `is_active = true`, `applies_to` chosen so the retrieval RPC always pulls them for WhatsApp + Meta lead capture:

| topic                 | title                                          | priority | applies_to                                                              | replaces                                                  |
|-----------------------|------------------------------------------------|----------|-------------------------------------------------------------------------|-----------------------------------------------------------|
| `lead_capture_flow`   | Founder's Phase Onboarding Sequence            | 3        | `whatsapp_ai_lead_capture, meta_ai_lead_capture`                        | Inline "ONBOARDING ORDER" block (brain L671–L740)         |
| `pricing_rules`       | Pricing Embargo & Founder's Reservation (v2)   | 4        | `whatsapp_ai_lead_capture, meta_ai_lead_capture, whatsapp_reply, all`   | Existing row + inline "PRICING VELVET ROPE"               |
| `pt_rules`            | Personal Training — Velvet Rope                | 4        | `whatsapp_ai_lead_capture, meta_ai_lead_capture, whatsapp_reply, all`   | Inline "DO NOT emit any PT-package…" lines                |
| `non_membership_intent` | Non-Membership Inquiry Redirect              | 5        | `all`                                                                   | Inline `NON_FITNESS_MESSAGE` + L720 prompt copy           |
| `facts` (update)      | Incline Fitness — canonical facts              | 11       | `all`                                                                   | Bump opening to **July 2026** verbatim, fix support email |

The non-fitness DB row uses the exact corrected wording you sent (`info@theinclinelife.com`, "front desk", 🙏).

### B. Update `ai_purposes.guards` in the same migration

- Set `guards.non_fitness_message` on the `whatsapp_reply` row to the new canonical copy (it's already DB-driven; we just refresh the value so the deterministic short-circuit at L213 stops using the inline default).
- Add `guards.opening_label = "July 2026"` so the prompt assembler can read it once (future use; no behavior change this turn).

### C. Strip duplication from `supabase/functions/_shared/ai-agent-brain.ts`

- Delete the inline `DEFAULT_NON_FITNESS_MESSAGE` literal (lines 205–206) and fall back to a short generic message only if the DB row is somehow missing. Pattern stays inline as defense-in-depth (regex isn't user-editable copy).
- Delete the inline `NON-FITNESS INTENTS …` block (L712–L722) — that content now lives in `ai_knowledge` and reaches the LLM through `<knowledge_base>` via `buildSystemPrompt`.
- Replace the inline plan-interest / PT / pricing prose (L671–L702) with a compact procedural scaffold (3–4 lines: "follow `lead_capture_flow` from knowledge_base; emit interactive_list shapes per spec; never invent prices") and rely on the DB rows for the actual policy text.
- Keep the JSON-shape contract for `interactive_list` and the final `lead_captured` payload inline — those are protocol, not editable copy.

### D. Re-prioritize the brain (deep audit)

After the migration the priority ladder becomes:

```
2  persona            Ananya — Member Concierge          (voice)
3  lead_capture_flow  Founder's Phase Onboarding         (NEW — what to ask, in what order)
4  pricing_rules      Pricing Embargo                    (refined)
4  pt_rules           PT Velvet Rope                     (NEW — split from pricing for editability)
5  identity_rules     Member-first identity              (existing)
5  booking_rules      VIP Tour Scheduling Window         (existing)
5  non_membership_intent  Redirect copy                  (NEW)
6  rules              Anti-parrot & anti-repeat          (existing)
7  rules              Grounding — never invent           (existing)
8  rules              Reply shape                        (existing)
10 format_rules       Formatting & length                (existing)
11 facts              Canonical facts (July 2026)        (updated)
20 behavior_rules     Answer-first behavior              (existing)
```

All ≤10 stay in the always-injected "rules" set; `facts` and `behavior_rules` ride retrieval. No rows deleted — only updated/added.

### E. Update public LLM/SEO files to July 2026

- `public/llms-full.txt`: change "Opens to public: 22 June 2026" and "before the 22 June 2026 public opening" → "July 2026".
- `public/llms.txt`: change "Opening: June 22, 2026" → "Opening: July 2026".
- No other date-bearing public copy was found.

### F. Verification (after migration)

1. `select id, title, priority, embedding is not null from ai_knowledge order by priority` — confirm 3 new rows + updated rows show `Ready` (the trigger will auto-embed; if any stay null, use the "Re-embed now" button you just shipped).
2. In WhatsApp test chat:
   - "what's the price?" → reply contains "Founder's Waitlist" pivot (proves pricing rule reached the LLM via RAG).
   - "I want a job at Incline" → deterministic guard fires, exact new copy from DB, lead is marked DNC.
   - "monthly plan?" → AI captures interest as `plan_interest=monthly`, does NOT refuse, does NOT quote ₹.
   - "when do you open?" → "July 2026".
3. Open AI Brain UI → confirm new rows render with "Rule" badge and the editable copy matches what's in chat.

### Out of scope

- No changes to `ai-prompt.ts`, `match_ai_knowledge` RPC, or the 3-row vs N-row architecture beyond adding 3 new rows.
- No changes to embed-knowledge auth (already fixed last turn).
- No edits to other edge functions, frontend pages, or the Brand context email (already correct).

### Files touched

- **New migration** — upserts 3 new `ai_knowledge` rows, updates `facts` content, updates `ai_purposes.guards.non_fitness_message`.
- `supabase/functions/_shared/ai-agent-brain.ts` — remove duplicated inline copy, replace with thin procedural scaffold.
- `public/llms-full.txt`, `public/llms.txt` — date fix.