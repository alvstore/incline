# Clean up Instagram chat header

## Problem (from screenshot)

The header for an IG conversation is rendering **three** Instagram icons stacked together plus two text badges, and the title falls back to `IG · 076057` whenever Meta hasn't returned a username/avatar:

```
[IG-icon avatar]   [IG-icon] IG · 076057  [Unknown]  [Instagram]
                   [IG-icon] IG ID · 1503595468076057
```

That's three IG glyphs + an "Instagram" word badge for a row that already lives in a pink "Instagram" themed pane.

Root cause in `src/pages/WhatsAppChat.tsx`:
- Avatar shows an IG fallback glyph **and** a corner platform dot (~lines 1020–1024).
- The title row prepends another `<PlatformIcon platform="instagram">` next to the name (line 1028).
- The subtitle row prepends a third `<PlatformIcon>` next to `IG ID · …` (line 1068).
- A separate "Instagram" word badge sits next to the "Unknown" identity badge (lines 1047–1055).

The same three‑icon stack also appears in the **contact list rows** (around line 918) and in the **empty‑state hero** at the very bottom (line 1561).

## Scope

UI‑only cleanup, no business logic / backend changes. The username/avatar resolution pipeline (Meta webhook → `upsert_meta_contact_profile`) is already correct — when Meta returns nothing (consent‑blocked IGSIDs), we simply present that fallback state more elegantly instead of stacking glyphs.

## Changes

All in `src/pages/WhatsAppChat.tsx`.

### 1. Chat header (selected conversation)

- **Avatar block (lines 1002–1025):** keep the avatar. The small corner platform dot stays **only when an actual `contact_avatar_url` is present** (so users can tell which network a real photo came from). When we're showing the platform glyph as the fallback itself, suppress the corner dot — no point stacking IG‑on‑IG.
- **Title row (line 1028):** remove the inline `<PlatformIcon …/>` before the name. The avatar already carries the platform signal.
- **"Instagram" word badge (lines 1047–1055):** remove. Redundant with the themed pink border + avatar dot. Keep only the identity badge (Unknown / Member / Lead / Contact).
- **Subtitle row (lines 1058–1071):** drop the leading `<PlatformIcon>` for IG/Messenger. Prefer this hierarchy:
  1. If `contact_name` looks like a handle (`@something`) → render `@handle` in mono, no icon.
  2. Else if it's an IGSID → render a friendlier label: `Instagram user · 076057` (last‑6 of the scoped id) in muted mono, no IG icon.
  3. WhatsApp branch unchanged (keeps the phone icon since it's a different glyph than the avatar).

### 2. `displayLabel()` (lines 156–164)

Soften the IG/Messenger fallback string from `IG · 076057` → `Instagram user` (no id in the bold title). The id moves to the subtitle only, where it's clearly metadata. WhatsApp branch untouched.

### 3. Contact list rows (around lines 905–935)

Apply the same dedupe: keep the avatar (with corner dot only when a real avatar image exists), drop the inline `<PlatformIcon>` next to the name in the row. The pink left‑border + avatar already mark IG rows.

### 4. Empty‑state hero (line 1561 area)

Leave as-is — it's a single decorative IG glyph, not a stack.

## Out of scope (call out explicitly)

- No edge‑function changes. The `resolveInstagramSenderProfile` flow and consent‑blocked caching stay as they are.
- No DB migration. We don't backfill any rows in this pass.
- Live Feed (`src/components/communications/LiveFeed.tsx`) is **not** touched — last turn's consolidation work stands.

## Verification

- Open an IG chat where Meta returned no profile (current Rajat‑style row): header shows **one** avatar with the IG fallback glyph, title reads `Instagram user`, subtitle reads `Instagram user · 076057`, only the identity badge ("Unknown") remains. No duplicate IG glyphs.
- Open an IG chat where `contact_name` starts with `@` (handle resolved): title shows the handle, subtitle shows `@handle` once, avatar corner dot present because an avatar image exists.
- Open a WhatsApp chat: header unchanged (phone icon + number in subtitle, no platform word badge needed since WA is the default).
- Contact list rows: each row shows at most one IG glyph (the avatar/avatar‑corner combo).
