# Website chat: step-by-step intake, then AI chat

## What visitors will see
1. Tapping **Chat with Incline** opens a clean intake panel (not chat bubbles). One question per screen, with a progress bar and Back/Next:
   - Step 1 — Name, mobile (+91), email
   - Step 2 — What are you looking for? (Membership · Personal training · Recovery & wellness · Group classes & Pilates · Just exploring)
   - Step 3 — Main fitness goal (tap cards)
   - Step 4 — Preferred membership plan (live plan names, no prices; "Not sure yet" allowed). Skipped when "Just exploring".
   - Step 5 — Review summary with edit links → **Start chat**
2. On Start chat the details are saved as a lead, then the chat window opens with a short greeting that uses their name and choices ("Hi Rajat, you're interested in Personal training for fat loss…"). The AI already knows everything, so it never re-asks.
3. A small "Your details" chip at the top of the chat lets them see/edit what they shared. Returning visitors (same device, 7 days) skip straight to their chat.

## Redesigned chat window
- Calmer header (brand, online status, minimise/close), message bubbles with timestamps, quick-reply chips (Prices, Book a visit, Facilities, Talk to desk), sticky input, typing indicator.
- Full-height sheet on phones, floating panel on desktop; keyboard and screen-reader friendly (focus moves per step, errors announced, 44px targets).
- Uses existing theme colours only.

## Team inbox (Team chat → Web Chat)
- Each web conversation shows a details card: name, mobile, email, looking for, goal, preferred plan, page they came from, and lead link.
- Every message (visitor + AI) is stored against that conversation and visible live.

## Safety switch
- A setting "Website chat: step-by-step intake" (on by default) lets you fall back to the current inline form instantly if anything breaks.

## Technical details
- `src/components/common/WebsiteLeadChatbot.tsx`: split into `IntakeWizard` (steps, zod per-step validation, honeypot kept) and `ChatPanel`; reuse existing `capture-lead` actions (`plans`, lead save, chat turns) and localStorage resume; pass intake profile into every chat call.
- `supabase/functions/capture-lead` + `_shared/websiteConcierge`: include intake profile (intent, goal, preferred plan) in the AI context; first AI message personalised; pricing rules unchanged (sales playbook, no AI-invented prices).
- `_shared/websiteChatStore.ts`: store intake profile as thread metadata so the inbox card can read it; `WhatsAppChat.tsx` renders the card for web threads.
- Flag read from existing settings table, fail-safe to new flow off → legacy if unreadable? No: default on, legacy only when explicitly off.
- Tests: wizard step validation, "Just exploring" skips plan step, profile included in AI payload. Playwright run at 375px and 1280px through intake → chat → message appears in Web Chat inbox.
