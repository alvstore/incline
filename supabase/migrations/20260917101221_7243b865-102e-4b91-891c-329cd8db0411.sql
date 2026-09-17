SELECT cron.unschedule('dr-replicate-nightly');

SELECT cron.schedule('dr-replicate-schema', '0 21 * * *', $$
  SELECT net.http_post(
    url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/dr-replicate',
    headers := jsonb_build_object('Content-Type','application/json','x-dr-secret',(SELECT token FROM private.dr_config WHERE id = true)),
    body := '{"mode":"schema"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);

SELECT cron.schedule('dr-replicate-auth', '10 21 * * *', $$
  SELECT net.http_post(
    url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/dr-replicate',
    headers := jsonb_build_object('Content-Type','application/json','x-dr-secret',(SELECT token FROM private.dr_config WHERE id = true)),
    body := '{"mode":"auth"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);

SELECT cron.schedule('dr-replicate-rows', '20 21 * * *', $$
  SELECT net.http_post(
    url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/dr-replicate',
    headers := jsonb_build_object('Content-Type','application/json','x-dr-secret',(SELECT token FROM private.dr_config WHERE id = true)),
    body := '{"mode":"rows"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);

SELECT cron.schedule('dr-replicate-storage', '40 21 * * *', $$
  SELECT net.http_post(
    url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/dr-replicate',
    headers := jsonb_build_object('Content-Type','application/json','x-dr-secret',(SELECT token FROM private.dr_config WHERE id = true)),
    body := '{"mode":"storage"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);