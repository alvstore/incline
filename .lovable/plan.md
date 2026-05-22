## Reviewing your plan

Your plan is mostly aligned with where the brain should go — RAG over `ai_knowledge`, identity routing, XML‑tagged prompt, no critique loop. Before locking it in, here are the things in your draft that don't match the current project and what I'd change.

### What needs adjusting in your draft

1. **"Next.js 15 / Edge"** — this project is **Vite + React + Supabase Edge Functions (Deno)**. There's no Next.js runtime. The edge function code stays in `supabase/functions/*/index.ts` (Deno, with `npm:` specifiers). Treat "Next.js 15" as a doc typo and target Deno edge.

2. **"Drop the HNSW index if it exists"** — there is none. The `embedding` column itself doesn't exist on `ai_knowledge` yet (only 13 columns; no vector, no `source_data`). It's a green field — nothing to drop.

3. **"Exact NN with similarity > 0.75, no top‑k"** — fine while the brain is < ~10k rows (sequential scan is < 50ms). But a threshold with no cap can either return zero rows (silent miss) or 200 rows (token blow‑up). I'll keep your threshold but add **floor / ceiling guards**: always include rows with `priority ≤ 10` (rules), always cap at 12 retrieved rows even if more pass the threshold, and if zero pass, fall back to top‑3 by raw distance so the model is never empty‑handed.

4. **"Real‑time DB webhook → embed‑knowledge"** — good. `pg_net` is enabled, so I'll implement it as an `AFTER INSERT OR UPDATE` trigger that calls `net.http_post` to the edge function (no manual webhook UI step needed, fully code‑managed and reproducible).

5. **"No critique loop"** — agreed, dropping it. The XML‑tagged grounded prompt + threshold retrieval should be enough; we can revisit if parroting persists.

6. **Identity routing already half‑exists** — `ai-agent-brain.ts` already calls `resolveMemberContext` (line 135) and creates leads when capture completes (line 444). What's missing is the **explicit `role` branch in the prompt**. I'll consolidate into a single `resolveSender()` that returns `{ role: 'member' | 'lead' | 'unknown', profile, plan }` and drive the prompt off it — not a parallel new pipeline.

7. **"Format JSONB to Markdown in the edge function"** — agreed (your plan), and this is also why product data should live in `ai_knowledge.source_data` rather than being mirrored from `membership_plans` by triggers. Simpler, one table to retrieve from. Admin UI gets a "Sync product catalog → brain" button that does the JSONB upsert on demand.

---

## Final plan (revised)

### Step 1 — Audit & cleanup (`ai-prompt.ts`, `ai-agent-brain.ts`)

- Delete the 60s `_kbCache` Map in `ai-prompt.ts`.
- Delete `loadBrainKnowledge` (replaced by `retrieveBrainContext` — see Step 3).
- Drop the legacy `persona_facts` row (4.6KB dump) after splitting it into 4–5 focused manual rows seeded in the same migration.
- Inside `ai-agent-brain.ts`: collapse the two parallel "load member then maybe lead" paths into one `resolveSender()` call. No behavior loss — just one identity source.

Summary of removed code will be posted in the implementation reply.

### Step 2 — Schema + real‑time embedding

Single migration:

```sql
create extension if not exists vector;

alter table public.ai_knowledge
  add column if not exists source       text  not null default 'manual',   -- 'manual' | 'catalog'
  add column if not exists source_ref   text,                              -- e.g. 'membership_plans:<uuid>'
  add column if not exists source_data  jsonb not null default '{}'::jsonb,
  add column if not exists embedding    vector(1536);

create unique index if not exists ai_knowledge_source_ref_uk
  on public.ai_knowledge(source_ref) where source_ref is not null;

-- NO HNSW / IVFFLAT index. Exact NN scan only (per spec).

-- AFTER write trigger → call embed-knowledge edge fn for the new/changed row
create or replace function public.tg_ai_knowledge_enqueue_embed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/embed-knowledge',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object('id', new.id)
  );
  return new;
end $$;

create trigger ai_knowledge_embed_after_write
  after insert or update of content, source_data, title on public.ai_knowledge
  for each row when (new.is_active and new.status = 'active')
  execute function public.tg_ai_knowledge_enqueue_embed();
```

New edge fn `embed-knowledge`:
- Body: `{ id }`.
- Loads the row, builds `embedInput = title + "\n" + content + "\n" + flatten(source_data)`.
- Calls Lovable AI Gateway (`google/gemini-embedding-001`, `dimensions: 1536`).
- Writes back `embedding`.
- Returns 200 always (DB trigger fire‑and‑forget).

### Step 3 — Retrieval (`ai-prompt.ts` v2)

New RPC `match_ai_knowledge(query_embedding, purpose, branch_id)`:

```sql
-- Exact NN (no index). Threshold = 0.75 cosine similarity.
-- Always include priority<=10 rules. Cap result at 12 rows.
-- Fall back to top-3 by distance if nothing passes the threshold.
```

`ai-prompt.ts` becomes:

```ts
export async function buildSystemPrompt({
  supabase, purpose, branchId, userMessage, identity,
}: BuildInput): Promise<{ prompt: string; retrieved: KnowledgeRow[] }> {
  // 1. embed userMessage via embed-knowledge fn (mode:'query')
  // 2. retrieved = match_ai_knowledge(embedding, purpose, branchId)
  // 3. render persona + XML-wrapped sections, return
}
```

No more cache. No more wholesale dump. Retrieval is per inbound message.

### Step 4 — Identity routing + XML prompt

`resolveSender(supabase, { senderId, platform, branchId })` →

```ts
type Identity =
  | { role: 'member';  member: MemberProfile;  plan: ActivePlan | null }
  | { role: 'lead';    lead:   LeadRow;        funnelStage: string }
  | { role: 'unknown'; senderId: string }
```

Flow: phone variants → `members` (active) → else `leads` (auto‑insert if absent) → else `unknown`. One function, called once per inbound message at the top of `ai-agent-brain.ts`.

Final prompt shape (built in `ai-prompt.ts`, same for every purpose):

```text
<persona>
  {{ai_purposes.system_prompt}}
</persona>

<strict_rules>
- Never invent prices, durations, or facilities not present in <knowledge_base>.
- Never repeat a question you have already asked in the last 6 turns.
- Never restate or paraphrase the user's request before answering.
- If the answer is not in <knowledge_base>, say so and offer to connect a human.
- Reply in one short message: ≤ 3 sentences unless the user asks for detail.
</strict_rules>

<user_context role="member|lead|unknown">
  name: ...
  plan: ...           // member only
  funnel_stage: ...   // lead only
  branch: ...
  locale: en-IN
</user_context>

<role_objective>
  {{ "Concierge: retention, account help, upsell to add-ons." if role=member
     else "Sales: qualify, share relevant package, book a tour." if role=lead
     else "Discovery: capture name + email, then qualify." }}
</role_objective>

<knowledge_base>
  ## [topic] Title
  content rendered as markdown
  (one block per retrieved row, ordered by similarity)
</knowledge_base>
```

### Step 5 — Catalog → brain sync

Add a small admin action `syncCatalogToBrain()` (button in AI Agent Hub → Brain tab) that upserts `ai_knowledge` rows from `membership_plans`, `pt_packages`, `benefit_packages`, `facilities`, `diet_plans` with `source='catalog'`, `source_ref='<table>:<id>'`, `source_data=row`, `content=rendered markdown card`. The webhook trigger then auto‑embeds them. No cron, no Postgres‑side markdown templating.

### Step 6 — Memory note

Add `mem://architecture/ai-brain-ssot-rag` documenting: SSOT table, threshold retrieval contract, identity router contract, XML prompt shape, and the catalog sync rule.

---

## Stack reality check

- Runtime: Deno edge functions, not Next.js.
- Vector ext: not yet enabled — added in Step 2 migration.
- `pg_net`: enabled (used for the after‑write webhook).
- Existing `resolveMemberContext` is reused inside `resolveSender`, not replaced.

Approve and I'll ship in this order: (1) migration + persona split + drop legacy row, (2) `embed-knowledge` edge fn, (3) `ai-prompt.ts` v2 + `resolveSender`, (4) wire into `ai-agent-brain.ts` + `lead-nurture-followup`, (5) Brain tab "Sync catalog" + "Test retrieval" UI.
