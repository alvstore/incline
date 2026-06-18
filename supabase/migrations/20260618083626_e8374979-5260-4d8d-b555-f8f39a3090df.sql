-- Scrub "July 2026" (and stray "in 2026") from every AI brain knowledge row.
-- The SEO files (public/llms*.txt, ai.txt) keep the date for crawlers; only
-- the bot-facing knowledge is sanitized.
update public.ai_knowledge
set
  content = regexp_replace(
    regexp_replace(
      regexp_replace(content,
        'July\s*,?\s*2026', 'a date to be announced', 'gi'),
      '\bin\s+2026\b', 'soon', 'gi'),
    '\b(open(?:s|ing)?|launch(?:es|ing)?|doors?\s+open)\s+(?:on|in|by)?\s*(?:[A-Za-z]+\s+)?20\d{2}\b',
    '\1 soon', 'gi'),
  updated_at = now()
where content ~* '(July\s*,?\s*2026|in\s+2026|(open|launch|doors)[^.]{0,40}20\d{2})';

-- Append a hard rule to the canonical facts row so RAG always surfaces it.
update public.ai_knowledge
set
  content = content || E'\n\nOPENING DATE EMBARGO: The exact opening / launch date has NOT been disclosed publicly. NEVER quote a month, year, or specific date. If asked, reply: "Our opening date hasn''t been announced publicly yet — Founding Members will be the first to know."',
  updated_at = now()
where topic = 'facts' and title ilike '%canonical%';