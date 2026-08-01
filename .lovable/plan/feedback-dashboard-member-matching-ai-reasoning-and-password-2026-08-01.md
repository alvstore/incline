# Feedback dashboard: member matching, AI reasoning, and password-reset email

## What's wrong (verified)

1. **"No record found in this branch"** — Aamil (INC-26-0008) and Sandeep chouhan (INC-26-0014) are both active members of the INCLINE branch, and their reviews are stored against that same branch. The matcher still returns `match_type: none` for both. Two causes: the member query joins profile names through an auto-generated foreign-key alias (which silently returns no name, so every member scores 0), and the similarity test is too strict for Google display names — "Aamil" vs "Aamil Khan" scores 0.61 against a 0.70 threshold.
2. **"Default heuristic — no AI key"** — the AI call actually succeeded (logged: provider Google, model gemini-2.5-flash, status success). The model returned its answer as plain content instead of the requested tool call, so nothing was parsed and the placeholder reasoning text was saved.
3. **Password reset email not delivered** — reset relies entirely on the built-in auth mailer; when that send fails there is no fallback and no error surfaced.

## Fixes

### 1. Member/lead matching
- Load branch members, then resolve their names with a separate profiles lookup (no FK-alias join).
- Replace the strict bigram check with a name score that also compares name tokens, so a shorter or longer Google display name still matches ("Aamil" ↔ "Aamil Khan", "Sandeep Chouhan" ↔ "Sandeep chouhan").
- Include the member code in the match evidence so the badge shows "Active member: Aamil · INC-26-0008 · active".
- Re-run classification on the existing reviews so the badges update.

### 2. AI reasoning
- Accept the model's answer whether it arrives as a tool call or as JSON in the message body.
- If neither parses, retry once in plain JSON mode before giving up.
- When the AI genuinely cannot be reached, save an honest reason (the provider error) instead of "no AI key".

### 3. Password reset email fallback
- Add a `request-password-reset` backend function: it generates the recovery link server-side and sends it through the existing communication dispatcher (our own email engine), which also logs the send so failures are visible.
- The reset form calls this function; the built-in mailer stays as the first attempt and our engine is the fallback.
- Send Ritesh Sharma a reset link once the path is live.

## Technical notes
- `supabase/functions/google-reviews-brain/index.ts`: rewrite `findAuthorMatch` (drop `profiles!members_user_id_fkey`), add `nameScore` token-overlap helper, harden `classifyOne` parsing (`toolCallArgs` → JSON content → one JSON-mode retry).
- New `supabase/functions/request-password-reset/index.ts`: `auth.admin.generateLink({ type: 'recovery' })` + `dispatch-communication` (channel `email`, category `transactional`). No user enumeration — always returns ok.
- `src/components/auth/ResetPasswordRequestForm.tsx` / `AuthContext.resetPassword`: call the function when the built-in reset returns an error.
- No schema changes; existing review rows are re-classified via the brain's `classify` action.
