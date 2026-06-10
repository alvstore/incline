-- Delete the placeholder vault entry from the previous migration
DELETE FROM vault.secrets WHERE name = 'embed_knowledge_service_role_key';

-- Restore trigger to use anon key (the embed-knowledge function will now accept it for row-id mode)
CREATE OR REPLACE FUNCTION public.tg_ai_knowledge_enqueue_embed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_url  text := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/embed-knowledge';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cXFwYnZuc3p5cnJnZXJuaW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE1NjIsImV4cCI6MjA4MTgwNzU2Mn0.EAmMC21oRiyV8sgixS8eQE3-b17_-Y9kn2-os8fv0Eo';
begin
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
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_anon
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