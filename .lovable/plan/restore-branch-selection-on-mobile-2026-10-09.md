# Restore branch selection on mobile

## Audit finding
- The role and branch rules in `BranchContext` are working and will remain unchanged.
- The desktop-only `AppHeader` renders the branch selector or fixed-branch badge, but it is hidden below the large-screen breakpoint.
- The three mobile header variants in `AppLayout` render navigation, branding, notifications and avatar only. `MobileNav` also has no branch control. This is why owners and multi-branch managers cannot switch branches on mobile.

## Implementation
1. Add one reusable mobile branch control driven by the existing `BranchContext` state.
   - Owner/admin: branch picker including **All Branches**.
   - Multi-branch manager: picker limited to assigned branches, with no **All Branches** option.
   - Staff, trainer, member and single-branch manager: compact read-only branch name, preserving their current restrictions.
2. Place the control consistently below the mobile top bar for vertical, collapsed, compact-horizontal and stacked-horizontal navigation modes.
3. Keep the existing branch change path intact so selection still persists locally and mirrors through `set_active_branch`; do not change queries, permissions, branch precedence or desktop behavior.
4. Make the control phone-safe: full available width, 44px touch target, truncated long names, visible focus state, semantic label, safe-area-aware spacing and no overlap with notifications or member bottom navigation.

## Verification
- Test authenticated mobile views at 394px and 375px as an owner: open the picker, switch from **All Branches** to a branch, navigate to another page, and confirm the selection persists and page data follows it.
- Verify a multi-branch manager only sees assigned branches and cannot select **All Branches**.
- Verify restricted roles see their branch but cannot change it.
- Check all navigation modes, desktop regression, long branch names, keyboard/screen-reader labeling, horizontal overflow, runtime errors and the automatic build result.

## Scope
Frontend presentation only. No database, permissions, business logic or branch-scoping changes.
