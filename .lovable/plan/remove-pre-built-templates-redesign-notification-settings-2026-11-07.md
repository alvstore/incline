# Remove Pre-built Templates + redesign Notification Settings

## 1. Remove "Plan & Benefit Templates"
- Delete `src/components/settings/PlanBenefitTemplates.tsx` (only used by Settings).
- Remove its menu entry, content mapping, import and the unused `FileBox` icon from `src/pages/Settings.tsx`.
- Old links to `?tab=plan-templates` fall back to the default settings tab.
- Existing plans and benefits already imported stay untouched (no data deleted).

## 2. Redesign Settings → Notifications
Same settings, same saving — layout and states only.

```text
[ Header: Notifications  ·  "Unsaved changes" pill  ·  Save ]
[ Channel summary strip: Email x/4 on · System x/5 on · Lead rules · Recipients ]
[ Reminder cadence (full width) ]
[ Email (col 6)          ][ System alerts (col 6)      ]
[ Lead notification cards (existing, same grid)         ]
[ Admin recipients (full width)                         ]
[ Sticky bottom save bar on mobile when changes pending ]
```

- Bento grid (`grid-cols-12`), rounded-2xl cards, icon badges, compact uppercase section labels.
- Each toggle row: whole row clickable, real label tied to the switch, 44px touch target, hover tint, short helper text.
- Group System alerts into "In-app" and "WhatsApp" sub-sections so channel is clear.
- Per-card "Turn all on/off" quick action.
- Unsaved-change tracking (compare to saved values) — Save disabled when nothing changed, spinner while saving, sticky footer on mobile.
- Skeleton loading shaped like the cards (replacing the bare spinner) and an error state with Retry.
- Design tokens only; checked with screenshots at 1440 / 1024 / 768 / 375 and a design-critic pass.

## Technical notes
- Files: `src/pages/Settings.tsx`, `src/components/settings/NotificationSettings.tsx` (refactor into a small `ToggleRow` + `ChannelCard`), delete `PlanBenefitTemplates.tsx`.
- No backend, query or preference-key changes; `LeadNotificationCards` ref-save contract kept as is.
- Remove the `as any` on `whatsapp_task_notifications`.
