# Voice agent (Ananya) — short, natural calls

## Audit findings
**Opening lines (sent by our app on every call)**
- Renewal openers are about 35 words long, and say the reason, the benefit and a permission question in a single breath.
- Stock phrases repeat in every version: "I wanted to help you…", "so there's no break in access", "Is now a good time for a quick minute?"
- The opener is always English, but the call language defaults to Hindi, so Ananya switches language straight after her first sentence.
- The member's own preferred language is ignored.

**Sarvam agent script (about 25,000 characters)**
- It is far too long for a voice agent. The rules repeat (no prices, one question at a time, match language, do not repeat), which makes replies stiff and slow.
- The greeting step asks for experience, intent and renewal in sequence, so the first minute feels like a survey.
- Corporate wording ("valued member", "fitness journey", "thank them sincerely", "premium facility") sounds like AI or telemarketing.
- Several template blanks appear empty in what you pasted (for example "membership plan () … expired on"). The blanks need checking in Sarvam to confirm they are filled in.

## What changes
1. **New opening lines: 8–14 words, one idea, then wait.** Written in Hinglish, Hindi and English:
   - Renewal (before expiry): "Hi Dilip, Ananya from Incline. Aapki membership 20 tareekh ko khatam ho rahi hai — do minute baat kar sakte hain?"
   - Renewal (already expired): "Hi Dilip, Ananya from Incline. Aapki membership 10 tareekh ko khatam ho gayi — renew karna chahenge?"
   - Check-in after absence: "Hi Dilip, Ananya from Incline. Kaafi din se club nahi aaye — sab theek hai?"
   - Unknown name: "Hello, Ananya from Incline — kya main [name] se baat kar rahi hoon?"
2. **Language follows the member.** The member's saved language is used where one exists. Otherwise calls open in Hinglish, and Ananya switches if the member answers in a different language.
3. **A rewritten Sarvam script (about 4,000 characters)** that keeps every safety rule, both call types, and the same outcome fields so the CRM keeps working:
   - The persona fits in 3 lines, written as a club concierge rather than a sales agent.
   - Each call type has 3–4 short steps: listen → one follow-up → offer a front-desk callback → close.
   - The safety rules are written once: no prices, no payments, never reveal the member code, stop calling immediately when asked, no medical advice, ask once to pin down a vague time.
   - A short list of phrases to avoid, plus natural replacements. Example: instead of "I completely understand your concern", say "Haan, samajh sakti hoon."
   - Closings of at most one line.
4. I'll give you the new script as a document to paste into Sarvam (Agent → Prompt), then publish a new agent version there. Our app sends calls to the agent version saved in settings, so that number needs updating once.

## Not changed
Calling limits, calling hours, do-not-contact checks, renewal case handling, the outcome fields (disposition, summary, callback time, absence reason, next step) and call recording all stay as they are.

## Technical details
- `supabase/functions/_shared/sarvam.ts`: rewrite `buildOpeningLine` with a language map (`hinglish|hindi|english`), date formats per language, and length guard tests.
- `supabase/functions/sarvam-voice/index.ts`: stop forcing `preferred_language: "Hindi"`. Resolve the language from member or profile data if a field exists, otherwise use `Hinglish`, then pass it to the opening line.
- Add opener tests: word count ≤ 16 per opener, the right opener per call reason, expired vs upcoming wording, no stock phrases.
- Save the new prompt as `docs/voice/ananya-sarvam-prompt.md` and as a file in Files. Deploy `sarvam-voice`.
- Verification: unit tests plus a manual test call from Settings (the user picks the number).
