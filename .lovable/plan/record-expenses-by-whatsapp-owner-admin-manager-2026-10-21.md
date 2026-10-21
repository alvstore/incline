# Record expenses by WhatsApp (owner / admin / manager)

## What you'll be able to do
Send a WhatsApp message to the club number like:

- "Paid 5000 to Dilip Meena in cash today"
- "Gave 1000 to Dilip Meena for housing, UPI"
- "Electricity bill 8,450 paid by bank transfer yesterday"

The assistant reads it, replies with a short summary to check, and saves it only after you reply **"yes"**:

```text
Expense to record — please confirm
Amount:   ₹5,000
Paid to:  Dilip Meena (team member)
Type:     Salary advance        (reply "general" to change)
Mode:     Cash
Date:     21 Oct 2026
Category: Salaries & Wages
Reply YES to save, or tell me what to change.
```

After "yes" it saves the expense as **Pending approval** in Finance → Expenses, with a note that it came from WhatsApp, and replies with the reference. Nothing is ever saved without that confirmation.

## Rules
- Only owner, admin and manager phone numbers can use it. Trainers, staff, members and leads cannot. Managers are limited to their own branch.
- **Paid to a team member** (name matches staff/trainer): asks whether it's a **salary advance** (recovered from payroll later) or a **general expense**. Housing/rent/allowance words → defaults to general; "advance" → salary advance.
- **Paid to someone outside** (vendor, electrician, landlord): general expense with that name as vendor.
- If the name matches several people, it lists them and asks you to pick. If amount or mode is missing, it asks.
- Mode understood: cash, UPI, card, bank transfer, cheque. Date understood: today, yesterday, or a date. Defaults: today, cash only if you said cash (otherwise it asks).
- Category guessed from words (rent, electricity, cleaning, repair, marketing, salary…); you can correct it.
- Every expense goes to the existing approval queue — no change to approval or payroll recovery.
- A branch switch lets the owner turn this off instantly (on by default).

## Example from your message
"I gave 1000 to Dilip Meena housing just now" → asks: salary advance or general (housing allowance)? Mode? → on "yes", saved as Pending.

## Technical details
- New service-role-only RPC `record_expense_for_actor(p_actor_user_id, …)` mirroring `record_expense` (same validation, same insert into `expenses`/`salary_advances`, status `pending`), but taking the verified WhatsApp sender's user id instead of `auth.uid()` (which is null in the webhook). Re-checks owner/admin/manager role and branch visibility for that actor. EXECUTE revoked from PUBLIC/anon/authenticated; adds `source='whatsapp'` + original message text into description/notes (add nullable `expenses.source` column).
- `supabase/functions/_shared/ai-ops-tools.ts`: two new financial-only tools — `draft_expense` (parses, resolves payee via employees/trainers/profiles, returns a draft + stores it in short-term chat memory with a 15-min expiry) and `confirm_expense` (requires a matching pending draft id; calls the RPC). The model can't save without a prior draft the user confirmed.
- Gate on `settings.whatsapp_expense_capture` (branch, default on) checked in the tool.
- Audit: the existing audit trigger records the insert; reply sent through the current staff-agent reply path.
- Tests in `scripts/tests/expenseCapture.test.ts`: amount/mode/date parsing, advance-vs-general default, non-financial role rejected.
- Deploy the WhatsApp webhook functions after the change; verify by drafting and confirming a ₹1 test expense from the owner number, then deleting it.
