# Fix health questionnaire + automatic AI precautions

## Why "Couldn't load questionnaire answers" shows
- The questionnaire lookup only allows the client's own trainer. When an owner, admin or manager opens the same panel (for example from the dashboard), it is refused, and the panel shows that error. The AI precautions have the same restriction.

## Changes
1. **Who can see it**: the client's trainer, owners/admins, and managers of that member's branch. Everyone else is still refused by the server. Every view is still recorded in the audit log.
2. **Automatic precautions, no button**: when the Goals & health panel opens, the saved precautions load straight away. If none exist yet, they are created automatically (short "Preparing precautions…" placeholder) and saved.
3. **Only regenerate on real change**: a new version is made only when **What they're looking for** (goals) or the **health details** (conditions or questionnaire "Yes" answers) change. Fitness level and age changes alone don't trigger a new one. The refresh button is removed for trainers. Owners and managers keep a small "Regenerate" link for manual corrections.
4. **Skip when nothing to flag**: clients with no health condition and no "Yes" answers show "No health precautions needed" and don't use AI.
5. Clear messages if AI is switched off for the branch or out of credits, instead of a broken panel.

## Technical details
- New migration: `_can_view_member_health(uid, member)` = trainer-owns OR `has_role(owner/admin)` OR manages member's branch (`managed_branch_ids`); used by `get_trainer_client_health` and the edge function. Service-role only EXECUTE on the helper.
- Edge function `trainer-health-guidance` v1.1.0: hash = goals + health_conditions + PAR-Q yes list; returns cached row when hash matches; `refresh` honoured only for owner/admin/manager.
- `useHealthGuidance` becomes an auto `useQuery` (enabled when the panel opens and there is a health note), `staleTime: Infinity`; `HealthGuidancePanel` loses the generate button, shows skeleton then result.
- Test: hash ignores fitness level/age and changes when goals or conditions change; a non-linked trainer is refused.
- Verify by calling the function as the owner for a member with a condition, then again to confirm the saved copy is returned.
