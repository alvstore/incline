# Employment contract fixes — role-only duties, correct notice period, new conduct terms

## What is wrong today
- The agreement text lists duties for **all three roles** (Fitness Trainer, Sales Staff, Manager) no matter which role is ticked.
- Section 7 always says **"90 (ninety) days"** — it is typed into the template. For this contract you entered 60 days, but the PDF ignores it. (The branch's HR settings also say 90 days for trainers, while the company-wide default is 60.)
- There are no clauses on under-the-table PT, outside supplements, or borrowing money.

## What will change

### 1. Only the selected role's duties
Section 1 shows just the chosen position (no tick-box list of all three), and Section 3 lists only that role's responsibilities. Trainer duties are expanded a little (session logging in the app, program design, punctuality for booked sessions).

### 2. Notice period follows what you enter
- The drawer gets a **Notice period (days)** field, prefilled from HR settings for the selected role, editable per contract.
- Section 7 and Section 13 use that number in words and digits (e.g. "60 (sixty) days").
- When the PDF is generated, the value saved on the contract (the one you entered, 60 here) is used, so the draft and signed PDFs always match.
- Notice applies equally both ways, as the 2026 Labour Codes expect; payment in place of notice is allowed.

### 3. New "Code of Conduct" section (all roles, trainer-specific wording for trainers)
- **No private / under-the-table PT:** no PT, diet or coaching for any member or prospect outside Incline's billed packages, inside or outside the premises. Any payment taken directly is treated as company money and recovered.
- **No outside supplements:** no selling, recommending for purchase, or supplying protein, pre-workout or any supplement or drug bought from the market. Only products sold through Incline's store are allowed. Banned or unsafe substances mean immediate termination and may be reported.
- **No money borrowing or lending:** no borrowing from, lending to, or money dealings with members, leads, vendors or co-workers. Salary advances only through the company's official advance process.
- Breach = misconduct under Section 12, with recovery as in Section 13.

### 4. Indian law alignment (wording tweaks)
- Deductions and recovery limited to what the law allows (Code on Wages, 2019): only for actual, proven losses, with written notice, never below statutory minimum pay.
- Post-exit non-solicitation of clients and staff stays. A general ban on working at another gym after leaving is not enforceable (Indian Contract Act, s.27), so it stays limited to the employment period.
- Fixed penalty amounts become "reasonable compensation for actual loss" (Contract Act, s.74), so courts are more likely to enforce them.
- Adds the POSH Act 2013 (sexual harassment at work) and DPDP Act 2023 (member data privacy) references, plus a line confirming PF/ESI under the Code on Social Security 2020.

### 5. Existing contracts
Already-signed contracts are not touched. Drafts like the current one pick up the new text when you open the contract and regenerate, or create it again.

## Technical details
- `src/components/hrm/CreateContractDrawer.tsx`: `getEmploymentAgreementTemplate` gets `noticeDays`. It renders one appointment line and a role-switched responsibilities block, adds Section "Code of Conduct" (renumber following sections), and puts in the legal wording changes. New notice field (react-hook-form, labelled, `aria-describedby` hint) prefilled from `getEmployerProfile` `notice_period_{role}_days`. It is saved to `contracts.notice_period_days` and `contract_variables.notice_period_days`, and terms regenerate when it changes.
- DB `contract_templates` rows (used when the role select changes) contain none of these clauses. Change the drawer so the built-in template always wins, keeping DB templates only as an explicit "Use saved template" fallback, to stop old text coming back.
- `supabase/functions/contract-signing/index.ts` PDF builder: before rendering, replace the `\d+ \(\w+\) days mandatory notice period` phrase with the contract's effective notice (contract_variables → column). Bump version comment and redeploy.
- Analytics event `contract_draft_generated` { role, notice_days } after a successful save (no personal data).
- Test: small unit test that a trainer template has no "SALES STAFF"/"MANAGER" sections, contains the given notice days, and has the three conduct clauses.
