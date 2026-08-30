# Project Memory

## Memories
- [WhatsApp Context Resolver V2](mem://features/whatsapp-context-resolver-v2-flag) — context.id-primary correlation ladder + WHATSAPP_CONTEXT_RESOLVER_V2 flag (default OFF, allowlist rollout)
- [Staff shift resolution engine](mem://features/staff-shift-resolution-engine) — punch→override→roster→block→grace ladder, dual-shift/night matching, staff_record_punch as only write path, shared MIPS timestamp parser
- [Attendance correction & payroll override](mem://features/attendance-correction-payroll-override) — manual/correct/delete/mark RPCs, branch+self guards, attendance_changed_at flag, explicit recalculate, approved-run reopen

- [PT commission GST-exclusive + installments](mem://features/pt-commission-gst-exclusive-installments) — pre-GST commission base, separate GST deduction, full-payment gating, monthly installments, duplicate protection
- [MIPS device churn & face verification](mem://integrations/mips-device-churn-and-face-verification) — drift-only reconciliation, IST quiet hours, recognition-proof face ledger
