# Let the Sarvam script open every call

## What changes
- The app stops sending its own long first sentence. Each call opens with the greeting written in your Sarvam script (version 12).
- Everything else stays the same: the member details the script uses, calling hours, daily limits, do-not-contact checks and saving the call outcome.

## Before you test
Your script needs a greeting line, because the app won't supply one any more. Add this at the top of the script in Sarvam:
- Renewal: "Hi {{member_name}}, Ananya from Incline. Aapki membership {{plan_expiry}} ko khatam ho rahi hai — do minute baat kar sakte hain?"
- Absence: "Hi {{member_name}}, Ananya from Incline. Kaafi din se club nahi aaye — sab theek hai?"

## Technical details
- `supabase/functions/sarvam-voice/index.ts`: remove `initialBotMessage: buildOpeningLine(...)` from the `createOutboundCall` call, so no `app_overrides.initial_bot_message` is sent. Agent variables stay unchanged.
- Keep `buildOpeningLine` in `_shared/sarvam.ts` but leave it unused. Add a short comment, plus a functions AGENTS.md rule: "Call greeting is owned by the Sarvam agent script; the app sends no initial_bot_message."
- Deploy `sarvam-voice`. After the change, the user places one test call from Settings to confirm the new greeting.
