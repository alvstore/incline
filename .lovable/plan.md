# Bhavik Jain — gifted assessment visibility and QR use

## Confirmed findings

- Bhavik Jain (`INC-26-0103`) is active with a Quarterly Plan through 11 Nov 2026.
- The gift exists and is unused: **1 Body Composition & Posture Scan**, attached to his active membership and expiring with it.
- Bhavik’s gift uses the exact scanner-recognized benefit record (`3d_body_scanning`), so it is eligible for QR authorization; this incident is not a mismatched gift type.
- The staff Benefits screen reads gifts from the complimentary-gift ledger, which is why the gift appears there.
- The member dashboard’s **My Entitlements** section reads plan benefits and purchased add-ons, but does **not** read complimentary gifts. The separate **My Benefits** page has the same omission. This is the visibility defect.
- Scanner authorization already includes valid complimentary gifts. The body/posture scanner flow consumes the gift only after a confirmed report arrives, and companion body + posture reports from the same assessment are not charged twice.

## Build plan

### 1. Use one member entitlement model

- Add a shared member-facing entitlement loader that combines:
  - plan allowance,
  - complimentary gifts,
  - purchased add-ons,
  - recorded usage and expiry.
- Match records by the benefit type ID rather than display text, so renamed benefits do not disappear.
- Include gift-only benefits even when the member’s plan does not contain that benefit.
- Exclude expired or fully used gifts while preserving them in staff history.

### 2. Redesign “My Entitlements” without changing the theme

- Replace the split plan/add-on presentation with compact bento benefit cards using existing semantic colors, typography, radii, and shadows.
- Bhavik’s assessment card will show:
  - **Body Composition & Posture Scan**
  - **1 assessment available**
  - **Complimentary gift**
  - expiry date
  - a clear **Scan at club** state explaining that he starts by scanning the QR shown on the HOWBODY device.
- Keep recovery benefits such as Steam Room bookable through the existing booking flow; scanner assessments will not be incorrectly sent to recovery booking.
- Apply the same combined balances to **My Benefits** so both member screens remain synchronized.

### 3. Keep updates immediate and reliable

- Subscribe/invalidate the correct gift, credit, usage, and membership query keys after grants, amendments, revocations, scan completion, and manual usage.
- Show loading skeletons, an error state with Retry, and a useful empty state rather than silently hiding failed data.
- Preserve all existing staff gifting, payment, expiry, scanner, and usage logic.

### 4. Accessibility pass

- Use semantic buttons/links and visible keyboard focus.
- Give icons accessible names or mark decorative icons hidden.
- Announce loading and entitlement changes politely to screen readers.
- Pair gift/available/expired colors with visible text and icons; maintain WCAG AA contrast.
- Keep primary touch targets at least 44×44 px and verify text does not clip at phone width.

### 5. Verification

- Add focused tests proving:
  - a gift-only assessment appears with one remaining use;
  - plan + gift + add-on totals merge correctly;
  - expired and exhausted gifts are excluded from available balances;
  - scanner assessments never receive a recovery-booking action.
- Sign in as Bhavik and verify the assessment appears below his other entitlements on dashboard and My Benefits.
- Use a real fresh scanner QR as Bhavik to verify the bind is accepted, then confirm one completed physical assessment consumes one gift while its companion report does not consume a second.
- Recheck staff Benefit Tracking to ensure the same remaining count and usage history are shown everywhere.

## Technical scope

- Frontend: member dashboard, My Benefits, shared entitlement aggregation, query invalidation, and focused tests.
- Backend: no schema change is expected. Only adjust scanner authorization if authenticated QR verification reveals a mismatch; otherwise leave the already-correct secure quota/consumption rules unchanged.
