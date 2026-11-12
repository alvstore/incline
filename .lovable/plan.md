# Fix plan: 5 System Health errors

These do not share one cause. Two are real bugs, two are noise that should stop being logged, one is a one-off from the preview reloading.

## 1. POS "Choose a reason for the manual discount" (1x) — noise
A cashier gave a manual discount without picking a reason. The check is correct, but it runs inside the sale step, so a normal "you forgot something" message gets logged as a system error.
- Check the reason before the sale starts: show the message under the discount box and keep "Complete sale" disabled until a reason is picked.
- Only log real failures to System Health, not missing-field messages.

## 2. Member "Request a diet/workout plan" fails (2x) — real bug
Members tapping Request on My Requests get an error every time. The server step reads a member's name from a field that does not exist on member records (the name lives on the profile).
- Rewrite the request step to read the name from the member's profile. Everything else (duplicate check, trainer assignment, task text) stays the same.
- Test by sending a request as a member and confirming the task appears for the trainer.

## 3. "No QueryClient set" (1x) — no change
Seen once on 11 Nov in the editor preview. The app setup is correct; this happens when the preview hot-reloads mid-edit. Nothing to fix; mark resolved.

## 4. "Unlisted origin cdn.gpteng.co" (37x) — noise
This is the Lovable editor's own script, which only loads in the preview. Add it to the allowed list so it stops filling System Health. Live site unaffected.

## 5. Trainer gets "Permission denied" assigning plans (10x) — real bug
A trainer on Fitness → Templates can search and pick any member in the branch, but is only allowed to assign plans to their own clients (assigned members or active PT clients). Picking someone else fails at save.
- For trainers, the member picker in Assign Plan shows only their own clients. Owners/admins/managers see the same list as now.
- If the save is still refused, show "You can only assign plans to your own clients" instead of a generic error.
- Permissions stay unchanged.

## Technical details
- POS: `src/pages/POS.tsx` — move the `reasonText` check into the button's disabled state and an inline hint; in `onError`, skip `console.error` for validation messages.
- Migration: `CREATE OR REPLACE FUNCTION public.create_member_plan_request` — `SELECT m.id, m.branch_id, p.full_name, m.assigned_trainer_id FROM members m LEFT JOIN profiles p ON p.id = m.user_id WHERE m.user_id = v_uid`. Keep the same signature, security definer and grants.
- `src/lib/security/originAllowlist.ts` — add `/^https:\/\/([a-z0-9-]+\.)*gpteng\.co$/`.
- `src/services/fitnessService.ts` `searchMembersForAssignment` — when the caller is trainer-only, filter results to members whose `assigned_trainer_id` is the trainer, or who have an active `member_pt_packages` row with that trainer (same rule as `trainer_can_view_member`). Map 42501/403 in `assignPlanToMember(s)` to the friendly message.
- Afterwards, resolve the 5 fingerprints in System Health.
