# Health conditions for trainers + AI precaution guide

## Audit findings
- Health conditions from registration are only shown in the "Client brief" panel on the trainer dashboard's "My clients" list (first 12 clients).
- The main **My Clients** page and today's PT session list don't show health conditions at all, so trainers usually miss them.
- The health questionnaire answers (PAR-Q yes/no questions) are not shown to trainers anywhere.
- No guidance on what to do about a condition.

## What we'll build
1. **Health flag everywhere a trainer sees a client** — amber "Health note" badge on My Clients cards, today's PT sessions and the dashboard list. Tapping opens the Client brief.
2. **Client brief upgrade** — health conditions, questionnaire answers that were "Yes", fitness level, goals and medical notes. Only for the trainer's own clients (assigned or PT package), checked by the server.
3. **"Get AI precautions" button** in the Client brief (shown only when there is a health note). AI returns:
   - What to watch for (warning signs to stop a session)
   - Exercises to avoid or modify
   - Safer alternatives and how to start (intensity, rest)
   - Questions to ask the member before training
   - A clear note: "Guidance only, not medical advice — ask for a doctor's clearance for serious conditions."
   Answer is saved so it loads instantly next time; "Refresh" regenerates it.
4. **Audit log** — each time a trainer views a health brief or asks AI, it's recorded (who, which member, when) and visible to owners/managers in the existing audit log. Health details themselves are not copied into the log.
5. **Off switch** — branch setting `trainer_health_ai` (on by default) to hide the AI button instantly.

## Accessibility
- Badge uses icon + text (not colour only), buttons labelled, AI answer area announces when ready, keyboard reachable, 44px tap targets.

## Technical details
- Extend RPC `get_trainer_client_briefs` to return `par_q` yes-answers + medical notes; keep `rpc_guard_applies()` + trainer-of-member check.
- New edge function `trainer-health-guidance` (Lovable AI, gemini flash): verifies JWT, re-checks trainer-of-member server-side, sends only conditions/level/age band/goals (no name/phone), returns structured JSON via tool calling. Handles 429/402.
- New table `trainer_health_guidance` (member_id, generated_by, conditions_hash, content jsonb, created_at) with GRANTs + RLS: trainer of member and branch managers read; writes service-role only. Regenerate when conditions hash changes.
- Audit inserts into `audit_logs` from the edge function and a guarded `log_health_brief_view` RPC (actions `health_brief.viewed`, `health_guidance.generated`).
- Analytics events: `health_brief_opened`, `health_guidance_generated` (no health data in properties).
- UI: `HealthFlagBadge.tsx`, AI section in `ClientBriefSheet.tsx`, wire into `MyClients.tsx`, PT sessions list, `ClientRail.tsx`; TanStack Query; theme tokens only.
- Tests: trainer refused for unlinked member; badge shows only for real conditions; guidance regenerates when conditions change.
- Verify with Playwright signed in as a trainer.
