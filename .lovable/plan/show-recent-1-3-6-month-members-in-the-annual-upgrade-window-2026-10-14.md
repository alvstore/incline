# Show recent 1/3/6-month members in the Annual upgrade window

## Why nobody shows yet
An upgrade offer is only created when a new 1, 3 or 6-month membership is saved. That rule went live today, and nothing was added for members who joined before it. So the upgrade list is empty, even though there are:
- **20 active 1-month members** who started in the last 15 days
- **7 active 3-month members** who started in the last 15 days
- 0 six-month members

## Fix
1. **One-time catch-up:** create upgrade offers for every active 1/3/6-month membership that started in the last 15 days (IST). Each window stays 15 days from its start date, so someone who joined 10 days ago sees "Day 11 of 15" and has 5 days left. If someone already has an offer, nothing is duplicated.
2. **No surprise messages:** members who are past Day 7 are marked as already reminded, so they don't all get a Day 7 offer at once. Anyone on Day 7 to Day 11 still gets the normal Day 12 "closing soon" reminder (once Meta approves the template). Members past Day 12 get no message; staff can mention the offer at the desk.
3. **Safety net:** a membership saved in any other way (dates set later, or plan switched from Annual to monthly) also gets its offer, through the same no-duplicates rule.
4. **Check:** confirm the Dashboard card shows about 27 members with the right day and upgrade cost.

## Question for you
There are two active Annual plans: **Annual Plan (₹36,900)** and **Essential Annual - Founder's Pass (₹25,000)**. Which plan should upgrades go to, and what price should they be measured against? Unless you say otherwise, I'll use the **Founder's Pass (₹25,000)** while it's on sale.

## Technical details
- Backfill: insert into the upgrade offers table from memberships joined to plans (duration 30/90/180, status active, start_date >= IST today − 14), with window_ends_at = start_date + 15 days, already_paid = price_paid and upgrade_cost = max(annual − paid, 0). Use ON CONFLICT (membership_id) DO NOTHING. Set status to day7_sent where the start date is more than 7 days ago.
- Make the annual-target choice explicit (a single setting) instead of whichever 365-day row the trigger finds first.
- Extend the trigger to also fire on update of plan_id/start_date, using the same idempotent insert.
- Verify with a count query and the Dashboard card in the browser.
