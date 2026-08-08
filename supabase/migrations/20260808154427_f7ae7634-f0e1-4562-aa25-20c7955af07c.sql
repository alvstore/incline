ALTER TABLE public.google_reviews_inbound
  ADD COLUMN IF NOT EXISTS review_permalink text,
  ADD COLUMN IF NOT EXISTS relative_time text,
  ADD COLUMN IF NOT EXISTS reply_mode text;