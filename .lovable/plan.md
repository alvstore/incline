# Mobile fixes for Plans, POS and Finance (owner/admin)

## Goal
At phone width (375–394px), these three screens show no sideways scrolling, nothing clipped, readable text and buttons that are easy to tap. Desktop and tablet look the same as today.

## Steps
1. **Check first:** sign in as the owner and take phone-size screenshots of /plans, /pos and /finance, including tabs, open drawers and tables. Write down every problem found: content running off the screen, crowded headers, tables that are too wide, small buttons.
2. **Plans:** headers and action buttons wrap or stack on phones. Plan and benefit cards become one column. Tab bars scroll sideways inside their own strip. Long plan names wrap to the next line.
3. **POS:** on phones, products fill the screen with a 2-column grid. The cart moves into a bottom bar showing item count and total, and opens as a drawer at full height. Customer search, discount and payment fields stack in one column. Checkout buttons stay easy to tap above the phone's home bar.
4. **Finance:** summary cards show 2 per row (1 per row for long amounts). Filters and the date range stack. Wide tables switch to cards on phones (date, description, amount, status) or scroll inside their own box. Charts resize to fit the screen width.
5. **Check after:** take screenshots again at 375px, 394px and 768px. Confirm none of the screens scrolls sideways and desktop is unchanged.

## Out of scope
Prices, payments, stock and money calculations stay the same. No backend changes.

## Technical notes
- Files: `src/pages/Plans.tsx`, `src/pages/POS.tsx`, `src/pages/Finance.tsx`, plus the child components they render that cause overflow.
- Only Tailwind responsive classes (`flex-col sm:flex-row`, `grid-cols-1 sm:grid-cols-2`, `min-w-0`, `truncate/break-words`, `overflow-x-auto` on tab lists and tables), existing design colours, `pb-safe` and 44px tap targets.
- Verify with Playwright and the injected owner session by checking `scrollWidth <= innerWidth` on each route and tab.
