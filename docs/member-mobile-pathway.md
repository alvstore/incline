# Incline native member app — pathway

The member app for Android and iOS is a **separate React Native (Expo) project**. This web repository has no native wrapper: Capacitor was removed, and `/member-app` and `/mobile-preview` redirect to `/member-dashboard`.

## Technology
- Expo SDK (latest) + React Native New Architecture (Fabric + TurboModules); screens use native iOS/Android views, not a WebView.
- Reanimated v3 + Gesture Handler for 60/120fps motion on the UI thread.
- Native bottom sheets (snap points, swipe-to-close) via `@gorhom/bottom-sheet` or `react-native-true-sheet`.
- Haptics via `expo-haptics`: light tap on tab switch, success on class/set booked, warning when one spot is left.
- Apple HealthKit (`react-native-health`) and Google Health Connect (`react-native-health-connect`): read steps, active calories, resting heart rate; write finished workouts.
- Face ID / fingerprint via `expo-local-authentication`; session stored in `expo-secure-store` (Keychain / Keystore).
- `@supabase/supabase-js` with the public key only, TanStack Query v5, `lucide-react-native`, theme tokens matching the web theme picker.

## Same backend, same rules (no new server)
| Journey | Reuse |
| --- | --- |
| Login / reset | Email or +91 mobile (`resolve-login-identifier`), password reset deep link |
| Home / membership | Same member-scoped queries as `useMemberData` |
| Classes | `book_class`, `cancel_class_booking` RPCs, IST dates, capacity server-side |
| Recovery | `book_facility_slot` RPC — advance-notice rules (Steam 12h, Sauna 24h, Ice Bath 24h) enforced by the server |
| Store / add-ons | `create_pos_sale` → Razorpay native SDK → server verification; abandon on dismiss |
| Workout / diet | `member_fitness_plans` (+ legacy diet fallback), PDF access |
| Feedback / requests | `feedback`, `approval_requests`, `tasks` — maker-checker preserved |
| Push | Only via `dispatch-communication` once a push channel + consent/token lifecycle exist |

Never: direct writes that bypass RPCs, privileged keys in the app, price quoting in chat, gate/hardware controls.

## Build order
1. Login, bottom menu, theme colours
2. Home, class booking, recovery booking
3. Store and checkout, workout player with health sync
4. Profile, feedback and requests, then push notifications
5. Publish with EAS Build: Android APK (internal) / AAB (Play Store), iOS build → TestFlight → App Store

**Release gate:** real-device QA of login, RLS, payments, booking rules, health permissions, privacy and account deletion before store submission.
