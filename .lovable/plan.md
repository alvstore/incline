# Plan: HRM Payroll Adjustments & Previews

Enhance the HRM payroll workflow to allow manual adjustments via a side drawer and provide a detailed preview before processing payments.

## User Requirements
- Manual adjustment action should be in a side drawer (Sheet).
- Adjustments must be pre-filled with current calculations.
- The "Process" button should show a preview before finalizing the payment processing.
- Restricted to Admin, Owner, and Manager roles.

## Technical Details

### 1. Manual Adjustment Side Drawer
- Create `PayrollAdjustmentDrawer.tsx` in `src/components/hrm/`.
- Pre-fill fields: Base Salary, PT Commission, OT, Bonus, Deductions, Advance Recovery, and Penalty.
- Include a "Reason" field for audit trails.
- Trigger this from the "Manual adjust..." dropdown menu item in `HRM.tsx` (or where the payroll list is rendered).

### 2. Process Preview Sheet
- Create `PayrollProcessPreviewDrawer.tsx`.
- This drawer will open when the "Process" button is clicked for a staff member.
- Display a summary of all components (Gross, Deductions, Net).
- Include a final "Confirm & Process" action.

### 3. Implementation in HRM.tsx
- Integrate the new drawers into the `HRM.tsx` (Payroll tab).
- Replace the existing `Dialog` for adjustments with the new `Sheet`.
- Update the "Process" button logic to trigger the preview drawer.

### 4. Logic & Security
- Ensure RBAC checks (`owner`, `admin`, `manager`) for these actions.
- Use `payroll_adjust_item` RPC for saving adjustments.
- Use `payroll_process_items` RPC for final processing.

## File Changes
- `src/components/hrm/PayrollAdjustmentDrawer.tsx`: New component.
- `src/components/hrm/PayrollProcessPreviewDrawer.tsx`: New component.
- `src/pages/HRM.tsx`: Integrate new components and update button logic.
- `src/components/hrm/StaffRowActions.tsx`: (If applicable) Update actions for payroll items.
