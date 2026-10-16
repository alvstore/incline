# System Health: fix plan for the 6 error groups

The six groups have different causes. Only two still need code changes (groups 1 and 6). Three are already fixed or were one-off outages, so they only need to be marked resolved. One gets a small change so it stops filling the log.

## Group 1: invoice search on /members fails with "branch_id is ambiguous" (needs a fix)
- **Cause:** the search function `search_command_invoices` returns a column named `branch_id`. Inside the function, the line `SELECT branch_id FROM user_visible_branches(...)` can't tell that name apart from the column of the same name in the function's own output, so every staff search breaks.
- **Second bug found here:** the filter has a missing bracket. Because of it, a member's search ignores what they typed and lists all of their invoices.
- **Fix:** one database change that rewrites the function:
  - Name the column explicitly: `SELECT v.branch_id FROM user_visible_branches(v_uid) v`.
  - Bracket the access conditions together: `(member condition OR staff branch condition) AND (search-term condition)`.
  - Keep the existing permission checks, the result limit and the order unchanged.

## Group 6: /renewal-center shows "Not authorized to manage renewals" (needs a fix)
- **Cause:** the tab counters always ask the server for counts, even for staff who don't have renewal access. The server correctly refuses, and each refusal is logged as an error. The main list already checks access first; the counters don't.
- **Fix:** in `src/hooks/useRenewalCenter.ts`, the counter request (`useRenewalQueueCounts`) only runs when the user has renewal access (`can.manageRenewals(roles)`, or the same check the main list uses). The page passes that access in, so counters stay hidden for users without access instead of erroring.

## Group 3: "m.profile_id does not exist" (already fixed, close it)
- The live `upgrade_window_summary` function no longer refers to `profile_id`; this was fixed in the 14 Oct dashboard change. The last error was 14 Oct at 2:36 PM.
- **Action:** mark it resolved. No code change.

## Group 5: Zoho Books 401 "not authorized" (already fixed, close it)
- Both errors happened on 13 Oct, during the move to the new workspace, before Zoho was reconnected. The reconnection was checked and working afterwards.
- **Action:** first confirm recent Zoho syncs succeeded, then mark it resolved. If any new 401 shows up, that's a real problem to look at instead.

## Group 4: member photo error 520 (one-off outage, quiet it down)
- A single temporary error from the file storage server while loading one biometric photo. Not caused by the app.
- **Fix:** temporary server errors (status 5xx) when loading pictures are logged as warnings, not errors, and the image retries once before falling back to the initials avatar. This only touches the place where photo-load failures are reported.

## Group 2: "Failed to reload index.css" (editor-only, close it)
- This came from the live editor reloading while a style change was half-saved. Real users never load the app that way.
- **Action:** mark it resolved, and filter `[hmr]` messages out of System Health so editor reloads aren't logged.

## Checks after the fix
- Search an invoice number and a member name as owner and as a member: results appear with no error, and a member only sees their own matching invoices.
- Open /renewal-center as staff without renewal access: no new "Not authorized" errors are logged.
- Re-check System Health: all six groups are resolved and no new errors with these fingerprints appear.

## Technical details
- One database change: `CREATE OR REPLACE FUNCTION public.search_command_invoices`, keeping the same signature, SECURITY DEFINER, `search_path` and existing grants.
- Front-end: an `enabled` guard in `useRenewalQueueCounts`; in the frontend error logger, treat storage 5xx as a warning and skip `[hmr]` messages.
