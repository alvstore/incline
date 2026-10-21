# PT components

- Trainer earnings UI reads only PT commission instalments via trainer_earnings_summary; never derive pay from session counts or hourly_rate fallbacks. The trainer GST cut applies only when the sale invoice charged GST (non-tax/BOS sales pay full commission).
- Trainer PT attendance comes from gate scans; direct Mark buttons render only when branch setting pt_manual_mark_enabled is true.
- Trainer-only users see/edit only classes where trainer_id is theirs (useTrainerScope + classes RLS via trainer_can_write_class); branch setting trainer_class_self_manage (default on) turns this view-only.
