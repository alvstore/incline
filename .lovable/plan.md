# Compact Annual upgrades widget

## Verified current layout
- Annual upgrades currently sits immediately below the Analytics headline card as a full-width section: four separate summary cards followed by up to ten detailed timelines.
- Analytics already has Membership Growth and Revenue by Plan cards, plus a side-panel pattern for viewing member details.

## New placement and size
- Remove the large Annual upgrades section from the top of Analytics.
- Place **one compact card alongside Membership Growth and Revenue by Plan**, grouping related membership performance information together.
- Use three columns on wide screens, two on medium screens and one on phones; avoid squeezing three cards into narrow widths.
- Target approximately **380–420px height** on desktop, comparable to neighbouring chart cards. The member count must never make the widget taller.
- Match Analytics typography, existing semantic colours, rounded corners, spacing and soft shadows. No new colour palette or nested cards.

## Compact card: summary + three members
- Header: **Annual upgrades**, a small **15-day window** label and a refresh icon with a tooltip.
- Replace the four large cards with small, unframed summary values: **Eligible**, **Closing soon**, **Upgraded this month** and permission-protected monthly upgrade revenue.
- Show **up to three members with the nearest deadlines**, as you selected.
- Each compact row contains the member name, joining date, a thin time-left bar and remaining days/hours. Keep full plan names, milestone labels and reminder histories out of the preview.
- Footer: **View all (count)** opens the complete timeline list. Do not add pagination or an independently scrolling member list inside the widget.
- Keep loading, error, empty and branch-selection states within the same compact footprint.

## Full detail in a side panel
- Use the existing Sheet pattern for the full list, with a fixed header, scrollable body and accessible pagination controls.
- Retain joining/start dates, current plan, exact IST deadline, milestone timeline, verified WhatsApp statuses and member navigation.
- Opening and paging the panel must not change the widget's three-member preview.
- Keep branch changes, refresh and deadline expiry synchronized between the preview and panel. Expired members disappear without expanding the card or leaving stale rows.
- Support keyboard navigation, Escape to close and focus returning to View all.

## Technical scope and skills
- Frontend-only changes to Analytics placement and focused compact/detail components; reuse the existing summary RPC, TanStack Query cache and shared deadline helpers.
- Keep the preview on the first result page and the panel pagination separate; reuse cached page-one data rather than introducing a new endpoint or changing its page size.
- Apply **UI/UX Pro Max** recommendations for dashboard density and progressive disclosure; run its design-system CLI after approval, preserving the project's existing tokens.
- Apply **Engineering Skills / Senior Frontend** composition, accessibility and shared-state guidance. Document the compact-preview/detail-panel structure in AGENTS.md during implementation.
- No changes to eligibility, the 15-day deadline, pricing, payment conversion, permissions, automation or messaging services. This redesign does not configure promotional email.

## Verification
- Check the widget and surrounding charts at 1440, 1094, 768 and 375px in both themes, with no text overlap or horizontal overflow.
- Verify real branch data: at most three deadline-ordered preview rows; View all exposes every active member through pagination; close/reopen and branch switching retain correct data.
- Verify the preview remains stable when paging the panel and when an offer expires.
- Run relevant existing upgrade tests and inspect preview errors; add a focused test for the three-member preview selection.