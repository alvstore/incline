-- v1.0.0 — AI Brain SSOT + RAG (semantic retrieval)

create extension if not exists vector;

-- ─── Schema: add source/embedding columns ──────────────────────────────────
alter table public.ai_knowledge
  add column if not exists source      text  not null default 'manual',
  add column if not exists source_ref  text,
  add column if not exists source_data jsonb not null default '{}'::jsonb,
  add column if not exists embedding   vector(1536);

alter table public.ai_knowledge
  drop constraint if exists ai_knowledge_source_check;
alter table public.ai_knowledge
  add  constraint ai_knowledge_source_check
       check (source in ('manual','catalog'));

create unique index if not exists ai_knowledge_source_ref_uk
  on public.ai_knowledge(source_ref) where source_ref is not null;

-- NOTE: no HNSW/IVFFLAT index. Exact NN scan is fast at the brain's scale
-- (< a few thousand rows) and avoids index-rebuild on every embed.

-- ─── Retrieval RPC ─────────────────────────────────────────────────────────
-- Always returns priority<=10 "rule" rows. Then rows passing the cosine
-- similarity threshold (default 0.75), ordered by similarity, capped at 12.
-- If nothing passes, falls back to the top-3 most similar rows so the model
-- is never empty-handed.
create or replace function public.match_ai_knowledge(
  query_embedding vector(1536),
  p_purpose       text,
  p_branch_id     uuid    default null,
  p_threshold     float   default 0.75,
  p_max           int     default 12
)
returns table (
  id          uuid,
  topic       text,
  title       text,
  content     text,
  source      text,
  source_data jsonb,
  priority    smallint,
  similarity  float,
  is_rule     boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  with scoped as (
    select k.*, 1 - (k.embedding <=> query_embedding) as sim
    from   public.ai_knowledge k
    where  k.is_active
      and  k.status = 'active'
      and  (k.applies_to && array[p_purpose, 'all'])
      and  (k.branch_id is null or k.branch_id = p_branch_id)
  ),
  rules as (
    select s.id, s.topic, s.title, s.content, s.source, s.source_data,
           s.priority, coalesce(s.sim, 0)::float as similarity, true as is_rule
    from   scoped s
    where  s.priority <= 10
  ),
  matched as (
    select s.id, s.topic, s.title, s.content, s.source, s.source_data,
           s.priority, s.sim::float as similarity, false as is_rule
    from   scoped s
    where  s.priority > 10
      and  s.embedding is not null
      and  s.sim >= p_threshold
    order  by s.sim desc
    limit  p_max
  ),
  fallback as (
    select s.id, s.topic, s.title, s.content, s.source, s.source_data,
           s.priority, s.sim::float as similarity, false as is_rule
    from   scoped s
    where  s.priority > 10
      and  s.embedding is not null
      and  not exists (select 1 from matched)
    order  by s.sim desc nulls last
    limit  3
  )
  select * from rules
  union all
  select * from matched
  union all
  select * from fallback
  order by is_rule desc, priority asc, similarity desc;
end $$;

grant execute on function public.match_ai_knowledge(vector,text,uuid,float,int) to authenticated, anon, service_role;

-- ─── Auto-embed trigger ────────────────────────────────────────────────────
create or replace function public.tg_ai_knowledge_enqueue_embed()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_url  text := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/embed-knowledge';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cXFwYnZuc3p5cnJnZXJuaW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE1NjIsImV4cCI6MjA4MTgwNzU2Mn0.EAmMC21oRiyV8sgixS8eQE3-b17_-Y9kn2-os8fv0Eo';
begin
  -- Skip if nothing embed-relevant changed
  if tg_op = 'UPDATE'
     and new.title       is not distinct from old.title
     and new.content     is not distinct from old.content
     and new.source_data is not distinct from old.source_data
     and new.is_active   is not distinct from old.is_active
     and new.status      is not distinct from old.status then
    return new;
  end if;

  if new.is_active and new.status = 'active' then
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon),
      body    := jsonb_build_object('id', new.id)
    );
  end if;
  return new;
exception when others then
  raise warning 'embed-knowledge dispatch failed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists ai_knowledge_embed_after_write on public.ai_knowledge;
create trigger ai_knowledge_embed_after_write
  after insert or update on public.ai_knowledge
  for each row execute function public.tg_ai_knowledge_enqueue_embed();

-- ─── Persona cleanup: drop outdated "July opening" dump, seed current rows ──
delete from public.ai_knowledge where topic = 'persona_facts';

insert into public.ai_knowledge
  (branch_id, topic, title, content, tags, priority, applies_to, status, source)
values
  (null, 'persona', 'Ananya — Member Concierge', $T$
You are Ananya, the Member Concierge for Incline Fitness, Udaipur.
Voice: warm, confident, concise (1–3 short sentences max), human — never corporate.
Channel: WhatsApp / Instagram DM. Reply in the user's language (English, Hindi, or Hinglish).
Brand: "The Incline Life by Incline" on legal/footer; "Incline Fitness" in conversation.
$T$,
   array['persona','identity'], 5, array['all'], 'active', 'manual'),

  (null, 'rules', 'Anti-parrot & anti-repeat', $T$
- NEVER restate, paraphrase, or summarize what the user just said before answering.
- NEVER promise to "share details soon" — answer NOW from <knowledge_base> or say you'll connect a teammate.
- NEVER ask a question you (or any prior assistant turn) already asked in the last 6 turns.
- If you must ask for missing info, ask for ONE field in ≤ 6 words.
$T$,
   array['rules','style'], 6, array['all'], 'active', 'manual'),

  (null, 'rules', 'Grounding — never invent', $T$
- Only state prices, durations, plan names, trainer names, class names, facility hours, or policy that appear verbatim in <knowledge_base>.
- If the answer is not in <knowledge_base>, say so honestly and offer to connect a human ("Let me have our team confirm and get back to you.").
- Never invent emojis or pricing examples to fill space.
$T$,
   array['rules','grounding'], 7, array['all'], 'active', 'manual'),

  (null, 'rules', 'Reply shape', $T$
- Default to 1 short message, ≤ 3 sentences. Add a CTA only if it earns its place.
- No bullet lists, no headers, no markdown tables in WhatsApp/IG. Plain conversational text.
- One emoji max, only if it fits the tone. Never an emoji-storm.
$T$,
   array['rules','format'], 8, array['all'], 'active', 'manual'),

  (null, 'facts', 'Incline Fitness — canonical facts', $T$
- Luxury fitness & recovery club in Udaipur, Rajasthan (Sector 14).
- Strength: Panatta. Cardio: premium imported. Recovery: infrared sauna, ice bath, steam, recovery lounge, 3D body scan.
- Classes: Personal Training, Pilates, Yoga, Zumba, group classes.
- Founder/Owner: Yogita Lekhari. Canonical website: https://theincline.in/
- For careers / vendor / press / partnership: info@theinclinelife.com (not handled in this chat).
$T$,
   array['facts','identity'], 11, array['all'], 'active', 'manual');