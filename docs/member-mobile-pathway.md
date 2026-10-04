# Incline member mobile pathway

## What is live today

`/member-app` is a responsive **web** member home, not an Android APK or iOS app. It reads the signed-in member's existing profile, membership, PT balance, upcoming class bookings and branch class schedule through the existing RLS-protected backend. The account photo, details and password controls use existing profile/auth flows. It sends members to existing live pages for classes, recovery slots, store/add-ons, workout and diet plans, progress, feedback and requests. `/mobile-preview` redirects to this member-only route; the simulated gate pass and sample workout/booking data are removed.

## Live data and workflow map

| Member journey | Current web implementation | Native implementation target |
| --- | --- | --- |
| Login and recovery | `/auth`, `/auth/forgot-password`, `/auth/reset-password` | Supabase session + secure device storage; configure verified email reset deep links to the native app |
| Home and membership | `/member-app`, `useMemberData` | Same member-scoped queries and states (active, frozen, scheduled, none) |
| Classes and recovery | `/book?type=classes`, `/book?type=recovery` | Same IST dates, capacity/advance-notice rules, and atomic booking/cancellation RPCs |
| Store and add-ons | `/member-store`, `/renewal-center` | Same branch catalogue, stock and server-verified checkout; use supported native payment integration |
| Training and nutrition | `/my-workout`, `/my-diet`, `/my-progress` | Same member plans, assigned coach, PDF access, empty states and protected measurements |
| Support | `/member-feedback`, `/my-requests` | Same feedback categories and request approval timeline; do not bypass maker-checker workflow |
| Account | `/member-profile` | Avatar upload, personal details, preferences, password change and sign-out |

## Native delivery sequence (separate project)

1. Create a dedicated Expo/React Native app and define Android application ID and iOS bundle identifier, signing ownership, privacy policy and store accounts. Do not package the Vite site as if it were native.
2. Establish navigation, theme tokens and accessible 375px-first components. Build a shared typed data layer against the existing Supabase project, TanStack Query v5, and secure session storage. Use only the public client key; never ship privileged service credentials.
3. Implement sign-in, reset deep links and profile first. Confirm branch-scoped RLS and member-only access on every data query, storage object and RPC from a real device before adding transactional features.
4. Ship home, class/recovery scheduling, plans/PDF viewing, store checkout, feedback and requests one workflow at a time. Reuse server-side booking and payment RPCs; no client-side capacity calculations or direct writes that bypass business rules. Keep money INR and protect member health data.
5. Add push only after consent/token lifecycle and a supported `dispatch-communication` push channel exist. Do not send outbound messages directly from the app. No simulated gate QR or gate control.
6. Run real-device Android/iOS QA: sign-in/forgot password, frozen and scheduled memberships, no-plan/empty states, capacity races, slot notice windows, cancellation, payment failure/retry, PDFs, slow/offline states, accessibility, and narrow screens. Review privacy permissions and deletion flow.
7. Configure EAS preview Android **APK** for internal testing, production **AAB** for Google Play, and a signed iOS production build for TestFlight/App Store. Distribution needs developer accounts, certificates, store metadata and approval; these builds cannot be produced from this web repository.

**Release gate:** No native launch until auth deep links, row-level security, payment verification, push dispatch, device QA and store compliance have been verified end to end. The web home is available independently of that native milestone.