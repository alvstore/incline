# PT components

- Trainer earnings UI reads only PT commission instalments via trainer_earnings_summary; never derive pay from session counts or hourly_rate fallbacks.
- Trainer PT attendance comes from gate scans; direct Mark buttons render only when branch setting pt_manual_mark_enabled is true.
