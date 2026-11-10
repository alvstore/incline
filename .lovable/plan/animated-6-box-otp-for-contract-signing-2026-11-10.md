# Animated 6-box OTP for contract signing

## Problem
The verify step uses one plain text box (max 200px) squeezed in a row with "Resend code" and "Change method", so on phones it looks cramped and unclear.

## What changes
- Replace the single box with **six separate digit boxes** (inspired by the referenced OTP-Input-Animation): each box pops in, the active box shows a soft pulsing caret, typed digits slide/scale in, and a wrong code gives a short shake plus red borders.
- Paste a full code or use phone SMS autofill — fills all six at once.
- Backspace moves to the previous box; arrow keys move between boxes.
- Boxes scale to screen width (about 44–52px each, never overflowing at 320px).
- "Resend code" and "Change method" move onto their own row beneath the boxes, full-width friendly on mobile.
- Reduced-motion users get no shake/bounce, just instant state changes.
- Colors use existing theme tokens only (primary, destructive, border).

## Technical details
- New `src/components/contract/AnimatedOtpInput.tsx` built on the existing `input-otp` primitive (keeps `autoComplete="one-time-code"`, `inputMode="numeric"`, single hidden accessible input with label "6-digit verification code").
- Animation with existing Framer Motion (already in project; no new dependency).
- Wire into `ContractSign.tsx` lines ~379–408; trigger shake when `otpError` changes. No backend changes.
- Verify with Playwright at 320/375/430px and desktop: no overflow, paste fills, error shake.
