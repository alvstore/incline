# Redesign Settings → Notifications (one consistent design)

## Audit (from your screenshot and the code)
- **Two design styles on one page:** the new Email / Team alerts cards use small titles and icon circles. The older Lead Alerts, Lead Team Alerts, Admin Recipients and Reminder cadence cards use big titles, larger text and different spacing.
- **Duplicate name:** "Team alerts" appears twice, once for staff alerts and once for lead alerts to admins.
- **Big empty space:** the Email card stretches to match the taller Team alerts card, leaving a blank area.
- **Lead alert switches look faded**, so it's hard to tell whether they're off or disabled.
- **Saving is confusing:** lead toggles save with the Save button, but admin recipient toggles save instantly. Nothing on the page says which is which.
- **No clear page structure:** six cards are stacked with no sections or way to jump around.
- **Accessibility:** lead and recipient switches aren't tied to their labels, recipient switches are small, and loading states are uneven.

## New layout
```text
[ Notifications header · Unsaved pill · Save ]
[ Section tabs: Reminders | Member messages | Team alerts | Lead alerts ]
[ Overview strip: 4 compact stat tiles (on/total per section) ]

Reminders      -> Reminder cadence (restyled, unchanged logic)
Member messages-> Email to members (4 toggles)          [col-span-12 lg:6]
Team alerts    -> In-app (4) + WhatsApp (1) for staff    [col-span-12 lg:6]
Lead alerts    -> "Message the lead" (SMS/WhatsApp/Email) [lg:6]
                  "Alert owners & admins" (SMS/WA/Email)  [lg:6]
                  Recipients table: name, masked phone, 3 channel chips
                  (saves instantly - labelled "Saves instantly")
[ Sticky save bar on mobile ]
```
- The sections show as tabs (`?tab=notifications&section=…`), so there are no lopsided columns or blank space. Each section is short and uses the same card style.
- **One shared card style:** rounded-2xl, soft shadow, no border, 20px icon badge, `text-base` title, xs uppercase group labels. Every row uses the same 44px toggle row, with the whole row clickable.
- **Clearer names:** "Member messages", "Team alerts" and "Lead alerts" replace the duplicate titles.
- **Status badges** show "On" in green, "Off" in grey and "Unsaved" in amber, so state isn't shown by color alone.
- Theme tokens only, with dark mode respected.

## Analytics (no personal data)
| Event | When |
|---|---|
| notification_settings_saved | Save succeeds (props: changed_count, section) |
| notification_section_viewed | Tab changes (props: section) |
| notification_recipient_toggled | Recipient save succeeds (props: channel, enabled) |
These will be added to the `src/lib/analytics.ts` event table.

## Accessibility checks
- Each switch gets a proper label with `useId`, and recipient switches get labels like "WhatsApp for Rajat".
- Tabs use the shadcn tabs with keyboard support, and every control has a visible focus ring.
- Save success or failure is announced politely to screen readers.
- Recipient channel toggles are at least 44px tall on mobile.

## Verification
- Signed-in screenshots at 1440, 1024, 768 and 375 px, plus a design-critic pass with findings fixed. No horizontal scroll at 375 px.
- Toggle, save and reload once to confirm values persist.

## Technical notes
- Files: `NotificationSettings.tsx` (shell, tabs and sections), `LeadNotificationSettings.tsx` (restyle onto shared `ToggleRow`/`SettingsCard`, keeping the `save()` ref contract and queries), new `src/components/settings/notifications/primitives.tsx`, a light restyle of the `ReminderCadenceCard` header only, and `src/lib/analytics.ts` docs.
- No backend or preference-key changes. Remove the `any` casts in the recipients mapping.
