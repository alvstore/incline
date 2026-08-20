# Plan: Trainer Profile & Payroll Enhancements

Enhance the trainer experience by providing transparent profile details, fixed Store access, and accurate payroll calculations including dual-shift bonuses.

## Technical Details

### 1. Trainer Profile Enhancements
- **File**: `src/pages/Profile.tsx`
- **Action**: Add a "Staff Information" section for users with `trainer` or `staff` roles.
- **Fields**: Address, Commission (PT Share %), Base Salary, and Aadhaar (last 4 digits).
- **Data Source**: Fetched via `useUnifiedStaff` mapping or direct query to `trainers`/`employees` tables.
- **Security**: These fields will be **read-only** for the trainer, consistent with HR management policy.

### 2. Member Store Access Fix
- **File**: `src/hooks/useMemberData.ts` (specifically `useUnifiedActor`)
- **Action**: Correct the branch resolution logic. Currently, `MemberStore.tsx` relies on `member.branch_id`. For trainers, this should fall back to `trainer.branch_id`.
- **Validation**: Ensure `actor.branch_id` is used consistently across the Store component.

### 3. Payroll Logic Refinement
- **File**: `src/pages/TrainerEarnings.tsx`
- **Calculation Logic**:
    - **Base Salary**: From `trainers.fixed_salary`.
    - **Dual Shift Bonus**: Query `staff_attendance` for the selected month. For every day where `shift_date` has 2 or more records (morning + evening), add `(Fixed Salary / 30)` as a bonus.
    - **PF Deduction**: 12% of `fixed_salary` only.
- **UI Update**: Show a breakdown of "Standard Salary", "Dual Shift Bonuses", "PT Commissions", and "PF Deduction".
- **Payslip Update**: Update `buildPayslipPdf` in `src/utils/pdfBlob.ts` (or the input passed from `TrainerEarnings.tsx`) to include these line items.

### 4. Identity Resolution Hardening
- **File**: `src/hooks/useUnifiedStaff.ts`
- **Action**: Ensure `aadhaar_last4` and `government_id_number` are correctly mapped and masked (e.g., `XXXX XXXX 6519`) before reaching the UI.

## User Review Required

> [!IMPORTANT]
> - Should dual shifts be calculated automatically based on any 2 check-ins per day, or only if they belong to different `shift_type` (morning vs evening)?
