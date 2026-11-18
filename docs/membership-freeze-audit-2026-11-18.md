# Membership freeze repair

## Findings and resolution

| Issue | Location | Fix | Severity |
|---|---|---|---|
| Missing allowance treated as 30 days | Staff freeze drawer | Null/zero means no included days; allowance rechecked by server | critical |
| Freeze/resume writes could partially succeed | Both drawers, membership services | Atomic request, activation and resume functions | critical |
| Early resume credited all requested/historical days | Resume drawer and approval processing | Preserved pre-freeze expiry plus actual IST days, capped at approved duration | critical |
| Unfreeze opened freeze drawer | Members list | Dedicated resume drawer | critical |
| Approval could freeze without a linked duration record | Approval processor | Fail closed; retain pending request for correction | serious |
| Fees could be invented or billed before approval | Freeze workflow | Saved branch fee, invoice on activation; no free-typed amount | serious |
| Unlabelled dates and disconnected validation | Freeze form | Associated labels, live status and described validation; native buttons and Radix focus trap | serious |
| Loading/error/phone states missing | Freeze and resume drawers | Skeleton, retry, scroll body, fixed footer, 44px controls, reduced-motion GSAP rows | minor |

## Workflow

- Staff plan freezes execute within remaining allowance and branch duration policy.
- Paid/waiver exceptions are default off. Management may enable the branch switch in the freeze drawer.
- Staff exceptions queue approval; management can apply exceptions immediately with a reason.
- Paid freezes require a positive saved branch fee. No new fee or tax rate was invented.
- Future approved freezes activate on their start day. Late approval starts on approval day, preserving the requested duration.
- The SQL-only daily due check runs at 18:35 UTC (00:05 IST), gated on pending work. Expired frozen periods resume with their approved day cap.
- Direct history writes are revoked. Existing membership triggers re-evaluate and queue gate state; no parallel client hardware command.
- Expiry edits while still frozen are blocked; resume first so subsequent corrections cannot be overwritten by a stale baseline.
- Exception flag owner: membership operations. This is a permanent safety switch, not a temporary rollout branch; review with branch policy changes.

## Raahul Mehtta · INC-26-0146

- Approved medical freeze: 18 November–17 December 2026 inclusive, 30 days, ₹0.
- Essential Annual plan includes zero freeze days; existing owner approval is preserved as an exception.
- Active pre-freeze audit snapshot confirms 1 September 2027 expiry; no premature extension was applied.
- Same-day resume preview: zero elapsed days, expiry stays 1 September 2027.
- Full-period resume: 18 December 2026; expiry becomes 1 October 2027.
- Remains frozen; saved hardware access state is revoked. No new freeze, bill or actual resume was performed.

## Verification

- 14 freeze/cancellation regression tests pass (23 assertions).
- Signed-in owner opened unified freeze and Raahul resume from real member rows.
- Deployed context reads Raahul's preserved exception and unchanged expiry. Another freeze submission is rejected.
- 1280px, 390px and 360px drawer screenshots reviewed; no horizontal overflow; Escape closes; reduced-motion emulation exercised; no browser page errors.
- Automatic preview build passes. Internal activation and due-worker functions are not executable by authenticated users.
- Successful new freeze/approval/fee/resume transactions and physical terminal acknowledgements remain unverified: no real member operation was performed merely for testing.
- Older AI-only freeze requests without a duration/history record now fail closed; desk must resubmit through the unified drawer. AI channel changes are outside this request.