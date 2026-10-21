# Emergency switch for the registration location check

## What you get
A clear on/off switch so owners and managers can turn off the "must be at the club" location check when phones (especially iPhones) are causing trouble. Registration then opens for anyone with the link, with no location prompt.

## Where it lives
**Settings → Security**, as a new card at the top: "Registration location check". It sits there because the check is an access rule (who can register and from where), next to the other access controls. It is also reachable from the registration screen itself (see below), so the desk doesn't have to hunt for it.

The card shows:
- A large switch: **On: only people at the club can register** / **Off: anyone with the link can register**
- The current status as text plus an icon (never colour alone), and who changed it and when
- An optional **auto turn-back-on** choice: after 1 hour, end of today, or never. This stops an emergency switch-off from being forgotten.
- A confirmation step when turning it off ("Registration will open for anyone with the link"), and a single tap to turn it back on

## Shortcut for the desk
When a signed-in owner or manager opens the registration page and the check is on, a small "Location issues? Turn off check" link appears in the green banner. It opens the same confirmation.

## What members see when it's off
No location prompt. They go straight into registration. A small neutral banner reads "Quick registration". Location never blocks them.

## Safety
- Only owners, admins and managers can change it. The database refuses the change from anyone else.
- Every change is recorded in the audit log.
- The public page can only read on/off. It cannot see who changed it.
- If the setting can't be loaded (bad network), the page uses the last known value. If there isn't one, it keeps the location check on, so the check is never switched off by mistake.

## Technical details
- Store one global row in `settings` (`branch_id NULL`, key `registration_geofence`, value `{enabled, disabled_until, updated_by, updated_at}`).
- Add a `get_registration_geofence()` SECURITY DEFINER function that returns only a boolean (it treats an expired `disabled_until` as on), granted to anon and authenticated.
- Add a `set_registration_geofence(enabled, disabled_until)` function with an `rpc_guard_applies` check and an owner/admin/manager role check. It writes an audit row and is granted to authenticated.
- New `src/lib/registration/useGeofenceSetting.ts` uses TanStack Query (`useQuery`, plus `useMutation` with an optimistic update and invalidation).
- `InClubGate` reads the setting; when it's off, it renders the children with a "Quick registration" banner. The desk shortcut lives in the same banner.
- New `RegistrationGeofenceCard` sits at the top of `SecuritySettings`. It uses the shadcn Switch with a `Label htmlFor`, `aria-describedby` help text, an `aria-live` status, and an AlertDialog for the turn-off confirmation (a simple confirmation, so it's allowed). Theme tokens only, lucide icons, 44px tap targets.
- A small test checks the expiry rule: an expired `disabled_until` means the check is back on.
