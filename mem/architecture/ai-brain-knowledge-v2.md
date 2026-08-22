---
name: AI Brain Knowledge Base v2 (curated)
description: Aug 2026 rebuild of ai_knowledge + ai_dynamic_memory — 19 curated entries, 10 training rules, duplicate-send guard
type: feature
---
# AI Brain Knowledge v2 — Aug 2026

All pre-existing `ai_knowledge` rows were archived (`is_active=false`, `status='archived'`)
and all `ai_dynamic_memory` rules deactivated. Reason: the old set contained direct
contradictions (a "Founder's Phase, pre-launch, date TBA" row alongside an
"Incline is officially OPEN" row) plus multiple overlapping funnel ladders, which made
the model oscillate and fall back to canned name prompts.

Replaced with:
- **19 `ai_knowledge` rows** (source `manual`) — persona, conversation discipline,
  location, facilities, climate (100% AC / no fans), recovery + safety, scanning,
  pricing blackout + price-pressure handling, memberships, PT, member self-service,
  lead capture etiquette, escalation, social links, visits, grounding, reply shape.
  No launch/opening date is stated anywhere. All rows auto-embedded via
  `tg_ai_knowledge_enqueue_embed`.
- **10 `ai_dynamic_memory` rules** (regex) — greeting (never answer a greeting with a
  name ask), pricing, handoff, frustration, location, timeline, decline,
  acknowledgement-is-not-a-name, AC/fans, trainer names.

Constraints to remember: `ai_knowledge.source` ∈ {manual, catalog}; `source_ref` is UNIQUE
(leave NULL for bulk inserts); `status` ∈ {active, suggested, archived}.

**Duplicate-send guard:** `whatsapp-webhook` → `sendAiReply` now suppresses any outbound
body identical to one already sent to the same phone in the last 24h (logged as a
`whatsapp_brain` warning via `log_error_event`). This is the structural stop for the
"same sentence three times" failure mode.
