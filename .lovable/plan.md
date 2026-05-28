# Plan: Phone Normalization Audit + Email-or-Phone Login

## Part 1 — Phone Normalization Audit (+91 / 091 / 91 / 10-digit)

**Goal:** Every write of a phone number anywhere in the platform passes through one canonical normalizer that:
- Strips spaces, dashes, brackets
- Strips leading `0`, `091`, `91` (when 10-digit Indian mobile follows)
- Stores as canonical `+91XXXXXXXXXX` (E.164)
- Rejects invalid (must be 10-digit starting 6/7/8/9 once Indian)
- Allows non-IN numbers if already `+<cc>...`

### 1.1 Canonicalize the helpers (single source of truth)
- `src/lib/contacts/phone.ts` — extend `normalizePhone()`:
  - Handle `091XXXXXXXXXX` (13 chars, leading `0`) → `+91XXXXXXXXXX`
  - Handle bare `0XXXXXXXXXX` (11 digits, leading 0 + 10-digit IN mobile) → `+91XXXXXXXXXX`
  - Reject obviously invalid (return `''`) so callers can decide
- `supabase/functions/_shared/phone.ts` — mirror the exact same rules server-side
- Add `isValidIndianMobile(input)` helper used by Zod schemas

### 1.2 Database trigger (defense in depth)
- New migration: `BEFORE INSERT OR UPDATE` trigger on `profiles`, `leads`, `contacts`, `whatsapp_chat_settings`, `staff` (any table with a `phone` column) that calls existing `normalize_phone_in()` SQL function
- Verify `normalize_phone_in()` itself handles the `0` / `091` cases; patch it if not
- This guarantees that *no matter how the row got written* (UI, edge fn, raw SQL, migration), the stored value is canonical

### 1.3 Frontend audit — every form that captures a phone
Sweep these files and ensure they use `<PhoneInput>` (which enforces +91 prefix) or call `normalizePhone()` before `.insert()` / `.update()`:
- Member create/edit drawer
- Lead create/edit drawer
- Staff/Trainer create/edit (HRM)
- Public self-registration (`/register`)
- Public lead capture (`EmbedLeadForm`)
- Contact Book add-contact
- WhatsApp manual-send "to" field
- Profile edit (member portal)

For each, add Zod validator: `z.string().refine(isValidIndianMobile, 'Enter a valid 10-digit Indian mobile')` and run `normalizePhone()` in the submit handler before write.

### 1.4 Edge function audit
Sweep edge functions that accept phone input and ensure they normalize before DB write or external API call (WhatsApp Graph API requires E.164 without `+`):
- `register-member`, `capture-lead`, `webhook-lead-capture`, `create-staff-user`, `create-member-user`, `send-whatsapp`, `send-sms`, `send-broadcast`, `dispatch-communication`

### 1.5 One-time backfill migration
Run an `UPDATE` across all phone-bearing tables to normalize existing rows. Report count of changed rows. Idempotent — re-running is a no-op.

---

## Part 2 — Email OR Phone Login (with password)

### 2.1 UX
Single "Email or phone" input on `LoginForm`. Auto-detect:
- Contains `@` → treat as email
- Otherwise → normalize as phone (`normalizePhone()`), reject if invalid

No tabs, no toggle — one input field, one password field. Same look as today.

### 2.2 Mechanism
Supabase auth is keyed on `email`. Two options — recommend **Option A** (simpler, no SMS cost):

**Option A (recommended): Phone-as-alias via lookup**
- On submit, if input is phone:
  1. Normalize to `+91...`
  2. Call new edge fn `resolve-login-identifier` (service-role) → looks up `profiles.phone = $1` and returns the associated `auth.users.email`
  3. Call `signInWithPassword({ email: resolvedEmail, password })`
- If input is email → call `signInWithPassword` directly (current behavior)
- Edge fn returns generic "Invalid credentials" if phone not found (no user enumeration)

**Option B: Native Supabase phone auth**
- Requires enabling Phone provider + SMS credits (Twilio/MSG91) — incurs cost, requires OTP flow
- User asked for **password** login, not OTP, so this isn't a fit

Going with **Option A**.

### 2.3 Files to change
- `src/components/auth/LoginForm.tsx` — change label to "Email or phone", update Zod schema to accept either, branch in submit handler
- `supabase/functions/resolve-login-identifier/index.ts` — new edge fn, JWT-not-required (public), rate-limited by IP, returns `{ email }` or 404
- `src/lib/auth/identifier.ts` — small helper `isEmail()` / `resolveIdentifier()`

### 2.4 Signup / password reset
- Out of scope unless you want them too — confirm if you also want signup + "forgot password" to accept phone

---

## Open questions
1. For the one-time backfill — OK to run during the same migration, or schedule for off-hours?
2. Should signup & forgot-password also accept phone, or only login for now?
3. Any non-India branches/members? (If yes, we keep the "already +CC" passthrough; if no, we hard-reject non-IN.)

