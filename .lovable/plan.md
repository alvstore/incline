
## Audit findings

The "Applies to" chips in `AIBrainTab.tsx` (New / Edit Brain Entry drawer) do work functionally — the server's `retrieveKnowledge` in `_shared/ai-prompt.ts:126` filters `ai_knowledge.applies_to` by `.overlaps([purpose, 'all'])`, so picking `whatsapp_reply` truly routes that brain row to the WhatsApp brain.

But the form is **not unified** with the rest of the AI hub. Three drift risks:

| # | Issue | File |
|---|---|---|
| 1 | Purpose list is **hardcoded** in `PURPOSE_KEYS` (10 strings). Drifts from DB. | `src/components/settings/AIBrainTab.tsx:40` |
| 2 | Same list **re-declared** with labels in `PURPOSE_LABELS` + `PRIORITY` | `src/components/settings/ai/HandlesTab.tsx:11,59` |
| 3 | Server has its own `Purpose` union in `_shared/ai-runtime.ts` | edge fns |
| 4 | Chips show raw keys (`whatsapp_reply`) — not the friendly title shown on Handles tab ("WhatsApp / Meta Replies") | drawer |
| 5 | No grouping by channel (Inbound / Outbound / Composer / Background) even though `HandlesTab` already has that metadata | drawer |
| 6 | No "Select All / Clear" affordance, no live count ("Applies to 3 of 9 handles") | drawer |
| 7 | No embedding-status pill — user has no signal the row was vectorised by `embed-knowledge` | list + drawer |
| 8 | If a row in DB has a typo in `applies_to` (legacy / hand-edited), the picker silently drops it on save | drawer |

## Plan — Unify "Applies to" with the live `ai_purposes` registry

### Step 1 — Create one shared registry hook (SSOT)

New file `src/lib/ai/purposeRegistry.ts`:

```ts
export type PurposeKey = string; // dynamic — read from DB

export interface PurposeMeta {
  key: string;                 // 'whatsapp_reply'
  title: string;               // 'WhatsApp / Meta Replies'
  description: string;
  channelGroup: 'Inbound' | 'Outbound' | 'Composer' | 'Background' | 'Member tooling';
  enabled: boolean;
}

export const PURPOSE_META_FALLBACK: Record<string, Omit<PurposeMeta,'key'|'enabled'>> = {
  whatsapp_reply:    { title: 'WhatsApp / Meta Replies', description: '…', channelGroup: 'Inbound' },
  lead_nurture:      { title: 'Lead Nurture Nudges',     description: '…', channelGroup: 'Outbound' },
  lead_score:        { title: 'Lead Scoring',            description: '…', channelGroup: 'Background' },
  review_reply:      { title: 'Google Review Replies',   description: '…', channelGroup: 'Outbound' },
  campaign_draft:    { title: 'Campaign Drafter',        description: '…', channelGroup: 'Composer' },
  template_generate: { title: 'Template Generator',      description: '…', channelGroup: 'Composer' },
  fitness_plan:      { title: 'Fitness Plan Generator',  description: '…', channelGroup: 'Member tooling' },
  dashboard_insight: { title: 'Dashboard Insights',      description: '…', channelGroup: 'Background' },
  automation_rule:   { title: 'Automation Rules',        description: '…', channelGroup: 'Outbound' },
};

// React hook: source-of-truth = live `ai_purposes` rows; fallback metadata
// supplies pretty labels. New purposes added via migration appear automatically.
export function useAiPurposes() { /* useQuery → from('ai_purposes').select('purpose, enabled').is('branch_id', null) */ }
```

`HandlesTab.tsx` and `AIBrainTab.tsx` both refactor to consume this hook → **single SSOT**.

### Step 2 — Rebuild the "Applies to" picker

Replace the flat chip wrap (lines 392–430 of `AIBrainTab.tsx`) with a grouped, labelled, search-aware control:

```
┌─ Applies to ────────────────────────────── [All] [Clear] ──┐
│  Wildcard                                                  │
│  [ ✓ all — share with every AI handle ]                   │
│                                                            │
│  Inbound                                                   │
│  [ ✓ WhatsApp / Meta Replies ]                            │
│                                                            │
│  Outbound                                                  │
│  [   Lead Nurture Nudges ] [   Google Review Replies ]    │
│  [   Automation Rules ]                                    │
│                                                            │
│  Composer                                                  │
│  [   Campaign Drafter ] [   Template Generator ]          │
│                                                            │
│  Background                                                │
│  [   Lead Scoring ] [   Dashboard Insights ]              │
│                                                            │
│  Member tooling                                            │
│  [   Fitness Plan Generator ]                              │
└────────────────────────────────────────────────────────────┘
Applies to 1 of 9 handles · WhatsApp / Meta Replies
```

Chip rules:
- Chip shows **friendly title** (key as small monospace caption underneath, only when search is open).
- Disabled-purpose chips render with `bg-slate-100 text-slate-400` and a tooltip "Handle disabled — entry will not be consumed until enabled".
- Selecting `all` deselects others (existing behaviour, kept).
- Selecting anything deselects `all` (existing behaviour, kept).
- "Select All non-wildcard" and "Clear" pills at top-right.
- Live counter under the picker reads `Applies to N of M handles · {comma-joined titles}` (max 3, then "+2 more").

### Step 3 — Unknown-key warning

When loading an existing row, if `applies_to` contains a key not in the live `ai_purposes` registry, render a yellow chip `unknown: foo` with `AlertTriangle` icon + tooltip "This purpose is not registered. Click to remove." Prevents silent drops on save.

### Step 4 — Embedding status pill (knowledge list + drawer footer)

In the brain-entry table row (`AIBrainTab.tsx` ~line 280), and in the drawer footer next to Save, query `ai_knowledge.embedding IS NOT NULL` and render:
- `Ready` (emerald, 4.5:1 contrast) — has embedding.
- `Embedding…` (amber + Loader2) — saved <60 s ago, no embedding yet.
- `Embed failed` (red) — older than 5 min, still no embedding (cron didn't pick it up).

Read-only — gives operators a real signal whether the trigger fired.

### Step 5 — Reuse, don't duplicate, in `HandlesTab.tsx`

Replace lines 11–69 of `HandlesTab.tsx` with imports from the new registry. Keep `PURPOSES_WITH_OPS` (it's a UI capability flag, not a list of purposes).

## Out of scope

- No DB schema changes. `ai_purposes` already has everything we need.
- No server changes (`_shared/ai-prompt.ts` retrieval untouched).
- No new migrations.
- No tooling/Zod runtime added — registry hook is enough.

## Files to touch

| File | Change |
|---|---|
| `src/lib/ai/purposeRegistry.ts` | **new** — hook + metadata SSOT (~80 lines) |
| `src/components/settings/AIBrainTab.tsx` | replace `PURPOSE_KEYS` hardcode (line 40), rebuild picker (lines 392–430), add embedding pill in list row + drawer (~120 lines edited) |
| `src/components/settings/ai/HandlesTab.tsx` | swap inline labels for registry hook (lines 11–69) — pure refactor, no behaviour change |

## Validation

1. Open New Brain Entry → confirm chips render with friendly titles, grouped by channel, `all` chip on top.
2. Disable `automation_rule` in Handles tab → reopen drawer → chip is greyed with tooltip.
3. Add a brain entry with `applies_to=['whatsapp_reply']` → save → list row shows "Embedding…" pill → polls to "Ready" within ~30 s.
4. Manually insert a row with `applies_to=['bogus_purpose']` via SQL → reopen → see yellow `unknown: bogus_purpose` chip with remove-on-click.
5. Insert a new purpose via DB (e.g. `ig_caption`) → no code change required → it appears in the picker automatically (proves SSOT).
