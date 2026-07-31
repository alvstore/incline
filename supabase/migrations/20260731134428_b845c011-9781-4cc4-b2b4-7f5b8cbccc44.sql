-- 1) Repair corrupted templates.variables (e.g. ["{{member_name}}"]) by
--    deriving the ordered, de-duplicated placeholder list from the content.
WITH expanded AS (
  SELECT t.id,
         btrim(m.x[1]) AS v,
         m.ord
  FROM public.templates t
  CROSS JOIN LATERAL regexp_matches(t.content, '\{\{\s*([^}]+?)\s*\}\}', 'g') WITH ORDINALITY AS m(x, ord)
  WHERE t.type = 'whatsapp' AND t.content IS NOT NULL
),
firsts AS (
  SELECT id, v, min(ord) AS ord FROM expanded GROUP BY id, v
),
ordered AS (
  SELECT id, jsonb_agg(v ORDER BY ord) AS vars FROM firsts GROUP BY id
)
UPDATE public.templates t
SET variables = o.vars,
    updated_at = now()
FROM ordered o
WHERE o.id = t.id
  AND COALESCE(t.variables, '[]'::jsonb) IS DISTINCT FROM o.vars;

-- 2) Track where an inbound Google review came from so the Places API
--    fallback and the Business Profile v4 sync can coexist.
ALTER TABLE public.google_reviews_inbound
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'gbp';