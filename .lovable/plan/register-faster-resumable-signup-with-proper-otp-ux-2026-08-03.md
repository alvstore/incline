# /register — Faster, Resumable Signup with Proper OTP UX

Three real problems in the public registration flow today, all confirmed in the code:

1. **No resend UX** — there is a bare "Resend code" link with no cooldown, no timer, no "code expires in", no "wrong number? change it", and no feedback when the server rate-limits (3 sends / 10 min returns 429, which currently surfaces as a generic red toast).
2. **Refresh wipes everything** — all form state lives in React state only. A refresh, an accidental back-swipe, or the browser reclaiming memory on mobile sends the member back to an empty Step 1.
3. **Slow / "stuck at rendering"** — both edge calls block on work that the member does not need to wait for:
   - `send_otp` awaits WhatsApp + email dispatch (`Promise.allSettled`) before responding.
   - `verify_and_register` awaits PDF render, storage uploads, staff notification, and **three sequential welcome dispatches** (WhatsApp, SMS, Email) before returning the session — this is the long spinner members see at the last step.

## What will change

### 1. Draft autosave and resume
- Persist the in-progress registration to `localStorage` (key `incline_register_draft_v1`, 24-hour TTL) on every field change, debounced.
- Saved: current step, profile fields, PAR-Q answers, goals, health conditions, consents.
- **Not saved:** government ID number and the signature image (sensitive / large). On resume the member re-signs — one tap, not the whole form.
- On mount, if a valid draft exists, restore it and show a small "We restored your details — Start over" bar at the top of the card.
- Clear the draft on successful registration.

### 2. OTP screen rebuild
- Live **"Resend in 0:29"** countdown (30s), then an enabled **Resend code** button.
- **"Code expires in 4:58"** countdown; when it hits zero the verify button disables and the screen prompts a resend.
- **Change number** link that returns to Step 1 with the phone field focused (details preserved).
- Auto-submit verification as soon as 6 digits are entered, plus paste/SMS-autofill support (`autoComplete="one-time-code"`).
- Friendly, specific errors instead of raw codes: `otp_invalid` -> "That code doesn't match", `otp_expired` -> "Code expired, tap Resend", `429 rate_limited` -> "Too many attempts, try again in 10 minutes" with the resend button locked for the cooldown.
- Resend keeps the member on the OTP screen (today a failed send throws them a toast with no state change).

### 3. Speed: make both edge calls return immediately
- `send_otp`: insert the OTP row, then hand WhatsApp/email dispatch to `EdgeRuntime.waitUntil(...)` and respond right away. Expected drop from ~2-5s to well under a second.
- `verify_and_register`: keep everything the member's account depends on inline (OTP check, auth user, profile, member row, signature upload, session tokens) and move the rest — waiver PDF render + upload, `member_onboarding_signatures` row, staff handoff, and the three welcome dispatches — into `EdgeRuntime.waitUntil(...)`. The three welcome sends also become parallel instead of sequential.
- Add a short-circuit so the signature-row insert still happens even if PDF render fails (path filled in by the background task).

### 4. Perceived speed / rendering
- Replace the single "Verify & complete" spinner with staged status text ("Verifying code..." -> "Creating your account..." -> "Almost there") so the last step never looks frozen.
- Compress the signature PNG before upload (the data URL is currently sent full-size in the JSON body — this is a meaningful chunk of the request payload on tablets).
- Lazy-load the hero image with an explicit low-cost blurred placeholder, and drop `fetchPriority="high"` on it so it stops competing with the form's first paint.
- Prefetch branches (`get_public_branches`) as before but with `staleTime` so re-renders don't refetch.

## Technical notes

- Files touched: `src/pages/PublicRegistration.tsx`, a new `src/lib/registration/useRegistrationDraft.ts`, a new `src/components/registration/OtpStep.tsx` (extracted from the page to keep it readable), and `supabase/functions/register-member/index.ts` (version bump to v1.2.0, redeploy).
- No database migration required. No change to the OTP contract, rate limits, or validation rules — the API surface stays identical, so nothing downstream breaks.
- Background work uses `EdgeRuntime.waitUntil`, which is supported on the current Deno runtime; every background task keeps its existing `captureEdgeError` wrapper so failures stay visible in System Health.
- Draft storage is same-origin `localStorage` only, holds no OTP, no password, no signature, and no government ID number, and self-expires after 24 hours.
