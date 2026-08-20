# Plan - AI Member Identity Resolution & Concierge Hardening

Registered members are being treated as leads on WhatsApp, resulting in inappropriate sales pitches and onboarding questions. This plan hardens the identity resolution logic to ensure confirmed members always receive high-end concierge service.

## Proposed Changes

### 1. AI Agent Brain
- **File:** `supabase/functions/_shared/ai-agent-brain.ts`
- **Identity Resolution:**
    - Enhance `resolveMemberContext` to search `profiles.phone` using a comprehensive set of phone variants (+91, 91, and bare 10-digit).
    - Ensure `isMember` is set correctly for WhatsApp, Instagram, and Messenger users by checking `profiles.id -> members.user_id`.
    - Ensure the `Identity` object passed to the prompt builder correctly tags the user as `role: "member"`.
- **Onboarding Guard:**
    - Explicitly skip the `shouldCaptureLead` block if `memberCtx.isMember` is true. This acts as a deterministic fail-safe.
- **Solicitation & Intent Guards:**
    - Ensure members are not redirected by the "non-fitness" or "solicitation" guards unless the intent is truly disruptive, prioritising concierge tools for members.

### 2. AI Prompt System
- **File:** `supabase/functions/_shared/ai-prompt.ts`
- **Concierge Role:**
    - Update the `<role_objective>` for members to be even stricter about omitting tour CTAs and email collection.
    - Reinforce greeting members by their first name as resolved from their gym profile.
- **Strict Rules:**
    - Add a high-priority rule in `<strict_rules>` to never treat a member-role user as a lead.

### 3. Webhook Entry
- **File:** `supabase/functions/whatsapp-webhook/index.ts`
- **Audit Logs:** Add more granular logging in `triggerAiAutoReply` to track resolved `isMember` status and role for debugging identity resolution failures.

## Technical Details

- **Phone Variants:** Use the existing `phoneVariants` utility to generate all potential formats for the inbound sender ID.
- **Identity Resolver:** The current `resolveMemberContext` already has logic for this but may be failing due to missing `profiles` match or incorrect platform-specific ID handling. I will harden the fallback chain.
- **Prompt XML:** The system uses XML tags for grounding; I will ensure the `role="member"` attribute in `<user_context>` is correctly leveraged by the LLM.

## Verification Plan

- **Automated Tests:** Run a dry-run check of the `resolveMemberContext` logic against sample member phone numbers.
- **Manual Verification:** Audit the `ai_call_logs` in the database to see the generated `systemPrompt` for recent conversations with the affected user (Urvashi).
