# Four fixes: MIPS sync crashes, AI conversation quality, photo pipeline, mobile app

## 1. `sync-to-mips` 546 "not enough compute resources"

Confirmed cause in the code: `sync-to-mips` imports `imagescript` and decodes/resizes member photos **inside the edge function** (`normalizePhotoBytes`, decode ceiling 2 MB, resize to 720px). Decoding a JPEG expands it to raw RGBA in worker memory; with a few people in one run the worker exceeds its memory budget and the platform kills it with 546.

Fix — take image decoding out of the edge runtime entirely:

- The browser already compresses on upload (`compressImageForDevice`). Extend it to also produce and store a **device-ready derivative** (JPEG, long edge 720px, sRGB, baseline, < 200 KB) next to the original, e.g. `biometric/<person>/device.jpg`.
- `sync-to-mips` fetches that derivative and streams the bytes straight to MIPS — no decode, no `imagescript` import at all.
- Fallback for people whose derivative doesn't exist yet: request the resized copy from storage's image transform (`?width=720&quality=80`) instead of decoding locally.
- Keep the existing circuit breaker and bounded timeouts; add a hard per-invocation cap (max N people per run) so any single run stays inside the memory/time budget, with the rest left queued for the next tick.
- One-off backfill: generate derivatives for existing biometric photos through a small batched job so no one is left on the slow path.

## 2. AI concierge — answer first, capture later

Confirmed cause: in `_shared/ai-agent-brain.ts` the "deterministic onboarding short-circuit" returns a hard-coded reply and **never calls the model** whenever name/email/goal/plan is missing. So:

- Rachita asks for monthly / six-month pricing → she gets "what's the best email…" instead of an answer.
- Divyanshi repeats herself → the same email sentence is sent five times, because only the *name* ask has a repeat counter (`countPriorNameAsks`); email, goal and plan have none.

Redesign of the funnel behaviour:

- **Answer the user's actual message first, every turn.** The model runs first and responds to what was asked (services, recovery suite, timings, location, tour, pricing policy). Capture is appended as a light, optional line — never the whole reply.
- **Repeat guard on every field**, not just name: after the same field has been asked twice with no answer, stop asking it and move on; after a third unanswered turn, drop capture for the session and just be helpful.
- **Identical-outbound suppression**: if the exact reply text was already sent in the last few turns, rephrase or skip — kills the "Yes, my name is Divyanshi" ping-pong.
- **Order becomes soft**: email is no longer a gate. Goal / interest can be captured from free text first; email is offered at a natural moment ("want me to email the tour details?").
- **Tone**: confident concierge, no repeated emoji sign-off on every line, varied phrasing, acknowledges what the person actually said.
- Existing hard rules stay intact: no prices, no opening date, embargo sanitizer, do-not-contact, human handoff.
- Verification: replay both uploaded transcripts against the brain and confirm the pricing question gets a real answer and no sentence repeats.

## 3. Photos: fix them instead of rejecting them

Today `checkPersonPhoto` blocks upload on small size / odd aspect / no face, and the user has to retake. Change to auto-remediate:

- Upscale-free **auto-crop and pad to a square portrait** rather than rejecting on aspect ratio.
- Auto-orient from EXIF, auto-brighten very dark images, re-encode as baseline JPEG.
- Only genuinely unusable inputs (undecodable file, or below a true minimum resolution where no template can be built) are refused — with a clear reason and a retake prompt.
- If the terminal later rejects the face, the existing ledger already marks `rejected` and asks for a retake — that stays as the safety net.

## 4. Android APK

The app is a React/Vite web app. An APK is possible via **Capacitor** (native shell around the built web app), and I can add the Capacitor config, Android platform and build scripts to the repo. What I cannot do here is produce a signed, installable `.apk` — that requires the Android SDK and your signing keystore, so the final `gradlew assembleRelease` runs on your machine or in CI. A quicker alternative with no store or build step is installing the site as a PWA ("Add to Home screen"), which I can enable in this project directly.

Tell me which you want and I'll fold it into the build.

## Technical notes

- Files touched: `supabase/functions/sync-to-mips/index.ts` (drop `imagescript`, stream derivative), `src/utils/imageCompression.ts`, `src/lib/media/syncPersonPhoto.ts`, `src/lib/media/checkPersonPhoto.ts`, `supabase/functions/_shared/ai-agent-brain.ts` (funnel rewrite + guards), plus a small backfill function for photo derivatives.
- No schema change is required for items 1, 2 and 4; item 3 may add one nullable column to record the derivative path.
- I don't need SSH into the MIPS host for any of this — the 546 is on our edge worker, not on your server. Please rotate that root password, since it was shared in chat.
