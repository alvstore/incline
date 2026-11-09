# Fix "Pending Plan" shown for members who already bought a future-start plan

## What's happening (verified)
SK Aman Islam (INC-26-0247) signed up through self-registration, so his profile was marked "waiting for a plan". Staff then sold him the Half Yearly Plan starting **15 Nov 2026**. ₹5,000 of ₹18,000 has been paid on BOS-INC-26-0144. The membership is correctly waiting for its start date.

The member list checks "waiting for a plan" **before** it checks for a scheduled plan. Because he signed up through self-registration, he keeps showing "Pending Plan" until 15 Nov. He should show **Scheduled · 15 Nov**. The top counters (Pending Plan / Scheduled) use the same order, so they are wrong too. He is the only member affected right now.

## Changes
1. **Member list status:** check for a scheduled plan first. If a member has an upcoming plan, show "Scheduled · <start date>" even if self-registration left them marked "waiting for a plan". "Pending Plan" will only show for people with no plan at all.
2. **Top counters:** use the same order so the Scheduled and Pending Plan counts match the list and its filters.
3. **Profile drawer badge:** read the same status, so it doesn't say "Pending Plan" while the list says Scheduled.
4. **Data:** nothing changes for this member's membership or invoice. On 15 Nov the existing start-date process activates him as usual. The ₹13,000 due stays visible.

## Technical details
- New migration replacing `list_members_page`: in `shaped.derived_status`, put `WHEN b.sch_id IS NOT NULL THEN 'scheduled'` before the `pending_plan` branch. Keep the signature, grants and everything else unchanged.
- `src/pages/Members.tsx` stats reducer (around line 362): check `scheduled` before `lifecycle_state === 'pending_plan'`.
- `MemberProfileDrawer.tsx`: no change needed if it reads `member.status` from the list. Check this after the change.
- Verify: rerun the RPC for INC-26-0247 and expect `derived_status = 'scheduled'`, then check the Members page in the preview.
