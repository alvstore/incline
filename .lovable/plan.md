# Registration must never break at the finish line

## What is happening

The live site at theincline.in/register throws "Can't find variable: photoIssues" on the final
success screen. That crash was already fixed in the project's code — the current code declares
and uses that value correctly — but the **published site is still running an older build**, so
visitors keep hitting the old crash.

So the fix is two parts: publish the corrected version, and make the success screen impossible
to break again.

## What to do

### 1. Publish the current version
The corrected registration screen is in the project but not live. Publishing pushes it out and
the reported crash disappears for everyone.

### 2. Make the success screen crash-proof
Right now, if anything at all goes wrong in the "You're in!" screen (photo box, dashboard link),
the whole page goes blank — and it goes blank *after* the member has already been created. That
is the worst possible moment to show nothing.

- Wrap the photo-upload box in its own protective shell. If it fails, the member still sees
  "You're in!", their member code, and the dashboard button; only the photo box is replaced by
  a short line saying the photo can be added later at reception.
- Show the member code on the success screen so the person always leaves with something useful,
  even if every optional part fails.

### 3. Confirm the registration itself is already saved
The photo is optional and is uploaded *after* the account exists. Verify in the code path that a
failed or skipped photo never rolls back or blocks the registration, and that the success screen
never depends on the photo having worked.

### 4. Verify the live flow end to end
After publishing, run through /register in a browser against the running app: fill details,
health questions, sign, verify code, land on the success screen, then deliberately upload a bad
photo and confirm the screen stays up with a clear "retake" message instead of going blank.

## Technical notes

- `src/pages/PublicRegistration.tsx` already declares `photoIssues` / `setPhotoIssues` (line ~99)
  and uses them in the `step === "done"` block; the live bundle `index-CST2RJ6i.js` predates it.
- Add a small local error boundary (reuse `@/components/common/ErrorBoundary`) around the
  photo block inside the `done` step, with a plain-language fallback.
- Keep `uploadAndSyncPersonPhoto` failures as non-fatal: they already only set `photoIssues`
  and a toast; assert no state write can throw outside the try/catch.
- No backend, database, or edge-function change is needed.
