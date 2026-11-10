# Show website chats in the Web Chat inbox

## What is wrong (verified)
- **No website chat message has ever been saved.** 3 website-chat threads exist, but there are 0 website-chat messages in the database.
- **Cause:** the website chat saves each message with type label `web_chat`. The database only accepts `campaign, ai, human, automation, transactional, system, inbound`, so every save is rejected.
- **Silent failure:** the error is written only to the function console. Nothing goes to System Health, so nobody noticed.
- **Inbox only lists chats that have messages.** So those 3 threads stay hidden, and the Web Chat tab shows "No human-needed chats". That wording is also wrong for this tab.
- **Inbox reads only the newest 1,000 messages** out of ~42,800. Older chats on any channel, website ones included, drop off the list.
- Past website conversations were never stored, so we can't recover them. Visitors who chat but never leave their details are also not stored, by design (privacy).

## Fix
1. **Save messages correctly.** Website visitor messages are saved as `inbound` and Concierge replies as `ai`. The `web_chat` channel stays recorded in the platform field.
2. **Report failures.** A failed save goes to System Health through the standard error logger, with no chat text included.
3. **Show threads even with no messages.** The inbox list also loads website-chat threads, so all 3 existing visitors appear with their name and a note that the earlier conversation wasn't saved.
4. **Complete inbox list.** Build the list from one row per conversation on the server instead of the newest 1,000 messages. Counts (All / Unread / Human) will then match reality.
5. **Live updates.** The Web Chat tab refreshes as new turns arrive, using the inbox's existing live channel and polling. A small "Live" dot shows on threads active in the last 5 minutes.
6. **Clear empty states per tab.** Web Chat with no chats says "No website chats yet. Conversations appear here once a visitor shares their details in the site chat." Fix the wrong "human-needed" wording.
7. **Accessibility.** Channel filter chips become a labelled toggle group with `aria-pressed`. The list announces new chats politely, and the Live dot also has a text label.

## Checks
- Unit test: stored rows use allowed type labels (inbound/ai), so the rule can't regress.
- Send a test website chat turn on preview, then confirm it appears in Web Chat with the reply, and confirm no System Health error.
- Confirm All count rises above the 1,000-row truncation and the 3 old web threads are listed.

## Technical details
- `supabase/functions/_shared/websiteChatStore.ts`: source_type `inbound` / `ai`; on insert/upsert error call `log_error_event` (source `edge_function`, fingerprint `web_chat_store`). Redeploy `capture-lead`.
- New `list_inbox_threads(p_branch uuid)` SECURITY INVOKER RPC (DISTINCT ON phone_number, latest message + left join `whatsapp_chat_settings` for message-less web threads), granted to authenticated; RLS still applies. Supporting index on `(branch_id, phone_number, created_at desc)` if missing.
- `src/pages/WhatsAppChat.tsx`: contacts query uses the RPC; per-filter empty-state copy; chip a11y.
- No feature flag: this is a bug fix with no behaviour risk to paid channels.
