## Epic 1 — Single source of truth for chat audio

### Root cause
Three independent hooks all play the WebAudio ping on the same inbound event:

1. `useGlobalChatSound()` in `AppHeader` → realtime INSERT on `whatsapp_messages`.
2. `useChatSound(inboundCount, phone)` in `WhatsAppChat` → fires on count delta.
3. `useChatSound(unreadCount)` in `NotificationBell` → fires when notification row arrives ~real‑time.

Result: 2–3 pings per inbound. Opening a chat can also ping when an invalidation refetch makes `inboundCount` rise without a `resetKey` change (e.g. realtime insert mid‑load), and there is no focus/active‑chat awareness.

### Implementation

**New file `src/lib/audio/chatAudio.ts` — global singleton**
- `notifyInbound({ branchId, conversationKey, isInternalNote })` is the only entry point.
- Internal state: `activeConversationKey`, last‑play timestamp, shared `AudioContext` (lazy, resumed on first user gesture captured at module init via one‑time `pointerdown`/`keydown` listener).
- Decision matrix:
  - `isInternalNote` → no sound.
  - `!isChatSoundEnabled()` → no sound.
  - `document.hidden` OR `!document.hasFocus()` → `playPing()` (current 880→1320 Hz tone, gain 0.18).
  - Focused AND `conversationKey === activeConversationKey` → `playPop()` (single 520 Hz sine, 60 ms, gain 0.04) — barely audible ack.
  - Focused AND different conversation → `playPing()` but at reduced gain (0.10).
- Debounce: ignore calls within 250 ms of the previous to coalesce burst inserts.
- Exposes `setActiveConversation(key | null)` and `playTest()` for the Settings "Test sound" button.

**`src/hooks/useChatSound.ts`**
- Keep `isChatSoundEnabled`, `setChatSoundEnabled`, `useChatSoundPreference`, `playPing` (re‑export from singleton for the test button).
- Replace `useGlobalChatSound` body with a single Realtime subscription that calls `notifyInbound(...)` for `whatsapp_messages` inbound inserts (filter `direction=eq.inbound`). Skip backlog using the existing `mountedAt − 1s` guard.
- **Delete** the `useChatSound(trigger, resetKey)` counter hook (the source of the click‑to‑open ping). Migrate callers below.

**Callers**
- `src/components/layout/AppHeader.tsx` — keep `useGlobalChatSound(!!user?.id)` (now routes through singleton).
- `src/pages/WhatsAppChat.tsx`
  - Remove the `useChatSound(inboundCount, phone)` line.
  - Add `useEffect(() => { setActiveConversation(selectedContact?.phone_number ?? null); return () => setActiveConversation(null); }, [selectedContact?.phone_number])`.
  - Ensure the contact‑list `onClick` only calls `setSelectedContact(...)` and `markAsRead(...)` — no sound, no message‑query side effect that could ping (singleton already gates on `activeConversationKey`).
- `src/components/notifications/NotificationBell.tsx`
  - Remove `useChatSound(unreadCount)` entirely. The bell already has its realtime channel for visual badge updates; sound is now owned by the global WhatsApp realtime subscription, so non‑chat notifications stay silent (correct behaviour — bell pings were a side effect, not a spec).

### Verification
- Open `/whatsapp` on the currently‑selected contact, send an inbound from another phone → one soft pop.
- Same, but with a different contact open → one normal ping.
- Switch tab away, send inbound → one full ping on return‑to‑focus is **not** played (we play at receive time, focus check happens then).
- Click between 5 chats rapidly → zero sounds.

---

## Epic 2 — Meta profile enrichment & UI sync

### Current state
- `whatsapp-webhook` parses `value.contacts[0].profile.name` and writes it to `whatsapp_messages.contact_name` only — never upserts into `leads`/`whatsapp_chat_settings.contact_name`, and never to `members.full_name`. WhatsApp Cloud API does **not** expose a profile photo (Meta restricts it) — we will not fabricate a fetch for it.
- `meta-webhook` already resolves IG `name + profile_pic_url` via Graph (`fetchIgProfile`) and writes `contact_avatar_url` on the message row, but does not propagate to `leads`.
- UI (`WhatsAppChat.tsx`) renders `<Avatar>` with `contact_avatar_url` + initials fallback already, but contact list groups by `phone_number` and only keeps the **first** non‑null avatar seen — when the most recent inbound has `null`, the avatar can disappear.

### Implementation

**DB — new helper RPC (migration)**
```
create or replace function public.upsert_meta_contact_profile(
  p_branch_id uuid,
  p_phone text,
  p_platform text,           -- 'whatsapp' | 'instagram' | 'messenger'
  p_external_id text,        -- wa_id or ig-scoped id or psid
  p_display_name text,
  p_avatar_url text
) returns void
language plpgsql security definer set search_path = public as $$ ... $$;
```
Behaviour:
- `whatsapp_chat_settings`: upsert `(branch_id, phone_number)` with `contact_name = coalesce(p_display_name, contact_name)` and a new `contact_avatar_url text` column (add via this migration; nullable).
- `leads`: if a lead row exists with the same phone in this branch, update `name = coalesce(name, p_display_name)` and new `avatar_url text` column (add); never overwrite a human‑edited name.
- Idempotent, no error if no lead row.

**`supabase/functions/whatsapp-webhook/index.ts`**
- After the message insert in `processIncomingMessages`, when `contactName` is non‑null call `supabase.rpc('upsert_meta_contact_profile', { p_branch_id: branchId, p_phone: message.from, p_platform: 'whatsapp', p_external_id: value.contacts?.[0]?.wa_id ?? message.from, p_display_name: contactName, p_avatar_url: null })`.

**`supabase/functions/meta-webhook/index.ts`**
- In the IG path that already calls `fetchIgProfile`, after `contact_avatar_url` is resolved, call the same RPC with `p_platform: 'instagram'` and `p_avatar_url: profile.avatar_url`.
- Messenger path: same RPC with `p_platform: 'messenger'`, avatar nullable (FB Graph requires page‑scoped token + extra perms — out of scope, leave null and let initials render).

**Frontend — `src/pages/WhatsAppChat.tsx`**
- Contact‑list grouping reducer: change the "keep first avatar" logic to "prefer non‑null avatar across the thread" (`existing.contact_avatar_url ||= msg.contact_avatar_url`) — already half‑done at line 334; mirror the same for `contact_name` (`||= msg.contact_name`).
- Pull `contact_avatar_url` and `contact_name` from `whatsapp_chat_settings` in the contacts query and merge as the authoritative source when present (covers chats with zero recent inbounds in the page window).
- Extract a tiny `<ChatAvatar contact={…} size="sm|md|lg" />` component in `src/components/communications/ChatAvatar.tsx` that wraps `<Avatar>` + `<AvatarImage src={avatar_url}>` + `<AvatarFallback>{initialsOf(name ?? phone)}</AvatarFallback>` with fixed `h-w` classes so layout never shifts between image and fallback. Use it in:
  - Contact list row (h‑11)
  - Conversation header (h‑10)
  - Empty‑state hero (h‑16)
  - Message bubble inbound (h‑8)
- Initials helper: first letters of up to two whitespace‑separated tokens; fall back to last 2 digits of phone for unnamed senders.

### Out of scope (called out so we don't promise it)
- WhatsApp profile picture: Meta Cloud API does **not** expose it. Initials fallback is the correct UX.
- Messenger avatar via Page‑scoped Graph: requires `pages_messaging` + page token plumbing — separate ticket.

---

## Files touched

```
NEW  src/lib/audio/chatAudio.ts
NEW  src/components/communications/ChatAvatar.tsx
EDIT src/hooks/useChatSound.ts
EDIT src/components/layout/AppHeader.tsx
EDIT src/components/notifications/NotificationBell.tsx
EDIT src/pages/WhatsAppChat.tsx
EDIT supabase/functions/whatsapp-webhook/index.ts
EDIT supabase/functions/meta-webhook/index.ts
NEW  supabase/migrations/<ts>_meta_contact_profile.sql
```

## Acceptance
- No duplicate pings under any combination of (WhatsApp page open / closed, NotificationBell mounted, tab focused / hidden).
- Clicking a chat list item never triggers a sound.
- Inbound from a known WhatsApp number shows the saved name immediately on first contact; IG inbound shows fetched name + profile pic; absent avatar always renders aligned initials of the same dimensions as the image variant.
