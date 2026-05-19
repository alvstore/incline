
-- ─── ig_comment_campaigns ───────────────────────────────────────────────────────
create table if not exists public.ig_comment_campaigns (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  integration_id uuid references public.integration_settings(id) on delete set null,
  name text not null,
  ig_media_id text,
  ig_account_id text,
  keywords text[] not null default '{}',
  match_type text not null default 'contains' check (match_type in ('exact','contains','starts_with')),
  case_sensitive boolean not null default false,
  reply_mode text not null default 'template' check (reply_mode in ('template','ai','hybrid')),
  dm_template text,
  ai_instruction text,
  ai_tone text default 'friendly',
  fallback_message text,
  comment_public_reply text,
  delay_seconds integer not null default 0 check (delay_seconds >= 0 and delay_seconds <= 86400),
  allow_repeat boolean not null default false,
  lead_tag text,
  pipeline_stage text,
  notify_staff boolean not null default true,
  human_review boolean not null default false,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  comments_matched integer not null default 0,
  dms_sent integer not null default 0,
  dms_failed integer not null default 0,
  leads_created integer not null default 0,
  last_triggered_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ig_campaigns_branch on public.ig_comment_campaigns (branch_id, is_active);
create index if not exists idx_ig_campaigns_account_media on public.ig_comment_campaigns (ig_account_id, ig_media_id) where is_active;

create trigger trg_ig_campaigns_updated_at
  before update on public.ig_comment_campaigns
  for each row execute function public.update_updated_at_column();

alter table public.ig_comment_campaigns enable row level security;

create policy "ig_campaigns_select" on public.ig_comment_campaigns
  for select to authenticated
  using (
    public.has_capability(auth.uid(), 'manage_automations')
    and (branch_id = public.get_user_branch(auth.uid()) or public.has_any_role(auth.uid(), array['owner'::app_role, 'admin'::app_role]))
  );

create policy "ig_campaigns_write" on public.ig_comment_campaigns
  for all to authenticated
  using (public.has_capability(auth.uid(), 'manage_automations'))
  with check (public.has_capability(auth.uid(), 'manage_automations'));

-- ─── ig_comment_runs ────────────────────────────────────────────────────────────
create table if not exists public.ig_comment_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ig_comment_campaigns(id) on delete cascade,
  branch_id uuid not null,
  ig_user_id text not null,
  ig_username text,
  ig_media_id text,
  comment_id text not null,
  comment_text text,
  matched_keyword text,
  action text not null check (action in ('send_dm','public_reply','tag_lead','notify_staff','capture_lead')),
  status text not null default 'pending' check (status in ('pending','scheduled','sent','failed','skipped')),
  skip_reason text,
  attempts integer not null default 0,
  scheduled_at timestamptz,
  executed_at timestamptz,
  error_message text,
  lead_id uuid,
  outbound_message_id uuid,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ig_runs_dedupe
  on public.ig_comment_runs (campaign_id, ig_user_id, action)
  where status in ('sent','scheduled','pending');
create index if not exists idx_ig_runs_campaign on public.ig_comment_runs (campaign_id, created_at desc);
create index if not exists idx_ig_runs_comment on public.ig_comment_runs (comment_id);
create index if not exists idx_ig_runs_due on public.ig_comment_runs (status, scheduled_at) where status in ('pending','scheduled');

alter table public.ig_comment_runs enable row level security;

create policy "ig_runs_select" on public.ig_comment_runs
  for select to authenticated
  using (
    public.has_capability(auth.uid(), 'manage_automations')
    and (branch_id = public.get_user_branch(auth.uid()) or public.has_any_role(auth.uid(), array['owner'::app_role, 'admin'::app_role]))
  );

-- Writes happen only via service role (webhook + executor)

-- ─── Atomic counter bump ────────────────────────────────────────────────────────
create or replace function public.bump_ig_campaign_counters(
  p_campaign_id uuid,
  p_comments_matched integer default 0,
  p_dms_sent integer default 0,
  p_dms_failed integer default 0,
  p_leads_created integer default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ig_comment_campaigns
  set comments_matched = comments_matched + coalesce(p_comments_matched, 0),
      dms_sent         = dms_sent         + coalesce(p_dms_sent, 0),
      dms_failed       = dms_failed       + coalesce(p_dms_failed, 0),
      leads_created    = leads_created    + coalesce(p_leads_created, 0),
      last_triggered_at = case when coalesce(p_comments_matched,0) > 0 then now() else last_triggered_at end,
      updated_at = now()
  where id = p_campaign_id;
end;
$$;
