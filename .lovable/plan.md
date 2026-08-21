# Plan: Trainer Dashboard & Store Audit

## Explore
- Audit `TrainerDashboard.tsx` for layout, density, and "Manual Check-in" logic.
- Investigate why `Store` is reportedly "not working" for trainers (permissions, data fetching, or routing).
- Review `MyShiftWeekCard.tsx` and `DutyStatusCard` to implement MIPS-locked check-out.

## Refactor
- **Redesign Dashboard**: Apply Vuexy-inspired aesthetics (`rounded-2xl`, soft shadows, better hierarchy) to `TrainerDashboard.tsx`.
- **MIPS Attendance Logic**: Modify `DutyStatusCard` to disable "Manual Clock In" if a MIPS check-in exists for today, and show "Clock Out" based on active duty status.
- **Store Fix**: Ensure trainers can access `MemberStore.tsx` (the shared store view) and that it filters correctly for their branch.
- **Visual Polish**: Standardize all cards and badges to match the project's premium theme.

## Technical Details
- Use `useTrainerData` and `useUnifiedActor` hooks to ensure consistent branch scoping.
- Update `trainerMenuConfig` in `src/config/menu.ts` to ensure `/member-store` is reachable.
- Add logic to `DutyStatusCard` to check `staff_attendance` for MIPS-origin entries before allowing manual actions.
