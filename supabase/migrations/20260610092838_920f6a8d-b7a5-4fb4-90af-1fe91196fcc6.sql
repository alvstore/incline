-- Store service role key in vault for the embed trigger
-- (Idempotent: only create if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'embed_knowledge_service_role_key') THEN
    PERFORM vault.create_secret(
      'PLACEHOLDER_REPLACE_WITH_SERVICE_ROLE',
      'embed_knowledge_service_role_key',
      'Service-role JWT used by tg_ai_knowledge_enqueue_embed to call the embed-knowledge edge function.'
    );
  END IF;
END $$;

-- Rewrite trigger to pull the service-role key from Vault
CREATE OR REPLACE FUNCTION public.tg_ai_knowledge_enqueue_embed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
declare
  v_url   text := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/embed-knowledge';
  v_key   text;
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
    select decrypted_secret into v_key
      from vault.decrypted_secrets
      where name = 'embed_knowledge_service_role_key'
      limit 1;

    if v_key is null then
      raise warning 'embed-knowledge: service-role key missing from vault (secret name: embed_knowledge_service_role_key)';
      return new;
    end if;

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object('id', new.id)
    );
    raise log 'embed-knowledge dispatched for ai_knowledge id=%', new.id;
  end if;
  return new;
exception when others then
  raise warning 'embed-knowledge dispatch failed for id=%: %', new.id, sqlerrm;
  return new;
end $function$;

-- Backfill: re-touch rows missing an embedding so the trigger re-fires.
-- (No-op until the vault secret value is set — see note above.)
UPDATE public.ai_knowledge
SET updated_at = now()
WHERE embedding IS NULL
  AND is_active = true
  AND status = 'active';