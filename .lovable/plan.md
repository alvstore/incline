# Fix contract-signing code screen crash and speed up WhatsApp code delivery

## What's wrong
1. **Crash ("Cannot read properties of undefined (reading '3')")**: the new six-box code input reads each box's state from a shared context that the code library doesn't fill in the way we set it up. The boxes then crash while drawing, and the signing page falls over before the person can type their code.
2. **Slow WhatsApp code**: the server runs several lookups one after another before it sends: the signing link, the contract, the contact, the channel and template check, the rate-limit count and saving the code. Only after all of that does it ask the messaging service to send, and that service runs its own checks too. Every step adds waiting time.

## Fixes
**Crash**
- Read each box's state from the data the code library hands to its draw function, and pass it into each box directly.
- Guard each box so missing data shows an empty box instead of crashing.
- Add a small test that draws the input with 0, 3 and 6 digits.

**Speed**
- Run the independent lookups at the same time: the contact and channel check, and the rate-limit count.
- Read the contract together with the signing link in a single request.
- Answer "code sent" as soon as WhatsApp accepts it, and keep fallback to email only when WhatsApp fails.
- Show "Sending…" on the button right away, and keep the 30-second resend timer from causing double sends.
- Add timing to the server logs for each step so we can see where any remaining delay comes from.

## How we check it
- Open the contract link at phone and desktop sizes, type and paste a 6-digit code, and confirm there's no crash.
- Send a real WhatsApp code to a test number, then compare the time it takes before and after from the timing logs. The target is under about 2 seconds on our side; delivery by WhatsApp itself is outside our control.

## Technical details
- `src/components/contract/AnimatedOtpInput.tsx`: use `render={({ slots }) => slots.map((s,i)=> <Slot slot={s} …/>)}` instead of `useContext(OTPInputContext)`.
- `supabase/functions/contract-signing/index.ts` `requestOtp`: `Promise.all` for `loadOtpChannelState` + throttle count; merge contract select via join; `console.time`-style step timings; redeploy.
- Check `dispatch-communication` for extra sequential lookups on the `force: true` transactional WhatsApp path and parallelize them if safe.
