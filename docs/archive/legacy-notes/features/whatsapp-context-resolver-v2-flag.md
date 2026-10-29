---
name: WhatsApp Context Resolver V2 flag
description: Feature flag + correlation priority rules for the WhatsApp conversation-context/provenance layer
type: feature
---

**Correlation priority (never change the order):**
1. Meta `message.context.id` → exact match on `whatsapp_messages.whatsapp_message_id` (outbound). PRIMARY.
2. Stored provenance columns on that outbound row (`campaign_id`, `communication_log_id`).
3. Unexpired thread context on `whatsapp_chat_settings`.
4. Recent outbound within 24h — LOW confidence FALLBACK ONLY, and only when a single distinct campaign exists in the window. Ambiguous (2+ campaigns) → no correlation. Never "latest campaign wins".

**Feature flag `WHATSAPP_CONTEXT_RESOLVER_V2`** (default OFF):
- Env var `WHATSAPP_CONTEXT_RESOLVER_V2` = on/off overrides everything (kill switch).
- Otherwise `settings` row (`branch_id IS NULL`, key `whatsapp_context_resolver_v2`):
  `{ enabled: bool, allowlist: [phones], recency_fallback: bool }`.
- `allowlist` non-empty = only those numbers get V2; empty = everyone.
- `recency_fallback:false` = context.id-only correlation (strictest mode).
- When disabled, the webhook skips the resolver entirely and the brain behaves as pre-v7.
- Flag cached 60s in the edge function.
