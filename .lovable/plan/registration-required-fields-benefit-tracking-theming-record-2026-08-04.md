# Registration required fields, Benefit Tracking theming, Record Usage drawer

## 1. /register — mandatory field audit

Current state (verified in the registration form's validation schema): only full name, phone (+91), email, date of birth, gender and branch are enforced. Address, city, state, postal code, government ID type/number, emergency contact, fitness goals and health conditions are all optional, so members can submit with them blank. The PAR-Q step also silently defaults every unanswered question to "no" before saving, so a member can skip the health screen entirely and still be recorded as having answered.

Changes (validation only — no change to the submit/OTP/signature flow):

- Required: address, city, state, postal code (6-digit), government ID type + government ID number, emergency contact name + emergency contact phone (+91, must differ from the member's own number).
- Health: at least one health condition must be chosen, with an explicit "None / no known conditions" option so honest blanks are still possible; the "Other" free-text becomes required when "Other" is selected.
- PAR-Q: every question must be answered yes/no before the step can advance — remove the silent default-to-"no". If any answer is yes, the existing details/notes field becomes required.
- Fitness goal: require at least one selection (already a picker, just enforced).
- Inline errors on each field, the step's Continue button blocks until valid, and the draft autosave keeps partially filled values as it does today.
- Existing members and backend writes are untouched; only new self-registrations are affected.

## 2. /benefit-tracking — theming and member photos

Verified: the page hero is hardcoded `from-violet-600 to-indigo-600`, cards use hardcoded `shadow-slate-200/50`, and focus rings use `focus:ring-indigo-500`, so the page ignores the active theme/brand colour (the rest of the app renders in the Incline red primary). The member search also builds initials-only circles — the query maps only name/email/phone and never reads the member's photo.

Changes:

- Replace all hardcoded violet/indigo/slate utilities with the app's semantic tokens (`primary`, `muted`, `border`, `ring`) so light, dark and brand themes all render correctly, keeping the same Vuexy shapes (rounded-2xl, soft shadow, no borders).
- Fetch and show member photos: include the profile photo in the search mapping and in the selected-member header, using an Avatar with initials fallback so members without a photo look unchanged.
- Same treatment for the stat cards, tabs and balance cards so nothing on the page is off-theme.

## 3. Record Usage — bottom sheet becomes a side drawer

Verified: `RecordBenefitUsageDrawer` uses the Vaul bottom `Drawer`, which is why it slides up from the bottom, breaking the project's side-drawer standard.

Changes:

- Rebuild it on the shadcn `Sheet` (right side, `sm:max-w-lg`) with the standard sticky header (title + description + close), scrollable body and sticky footer with Cancel / Record Usage.
- Keep the form, validation, benefit selection, remaining-count preview, validation call and mutation exactly as they are.
- Restyle with theme tokens to match the other drawers in the app.
- Check the sibling benefit drawers (Sell Add-On, Top-Up, Grant Gift) and convert any that still use the bottom drawer so the whole page behaves consistently.

## Technical notes

- `src/pages/PublicRegistration.tsx`: extend `detailsSchema`, add conditional refinements for "Other" health condition and PAR-Q yes-answers, and gate the PAR-Q step advance on a complete answer map instead of defaulting to "no".
- `src/lib/registration/healthQuestions.ts`: add a "None" option to `HEALTH_CONDITION_OPTIONS` if absent.
- `src/pages/BenefitTracking.tsx`: token swap, plus map `avatar_url` from the member search into an `Avatar`; if the `search_members` function doesn't return the photo, add a small follow-up query on the returned member ids rather than changing the function.
- `src/components/benefits/RecordBenefitUsageDrawer.tsx`: swap Drawer primitives for Sheet; no hook or service changes.
