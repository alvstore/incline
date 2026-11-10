# Incline documentation

## Implementation guides

- [Flutter Member app — complete guide and roadmap](flutter-member-app-readme.md): member-only app (refuses team accounts), general/PT daily plans, PDFs, progress, HOWBODY, bookings, referrals and release gates.
- [Flutter Team app — staff/trainer/manager/owner guide and roadmap](flutter-team-app-readme.md): separate role-based app, feature map from the web, verified server functions, release switches, phases T0–T6.
- [Team mobile PWA motion blueprint](team-pwa-motion-blueprint.md): Halvi-inspired layout and exact GSAP timings, using only Incline theme tokens.
- [Communication dispatcher](communication-dispatcher.md): canonical outbound delivery architecture.
- [Browser notifications](browser-notifications.md): web push and privacy boundaries.
- [Production readiness](production-readiness.md): operational checks and known dependencies.
- [Deprecated table audit](deprecated-table-audit.md): evidence for retained or retired database objects.

## Historical reference

- [Legacy project notes](archive/legacy-notes/index.md): preserved physical notes from earlier work. These are historical records, not current policy; current engineering rules live in root/nested `AGENTS.md` and current guides above. Legacy `mem://` links reference the agent memory system, not files in this archive.
- [MIPS API reference](../.lovable/mips-api-reference.md): existing internal integration reference; retained in its original location to preserve links.

Flutter has **two guides**, one per app (member, team). Root `README.md` is the project entry point; root `roadmap.md` tracks ongoing work. Served assets/model attribution stay with their assets, and managed plan history stays in `.lovable/`.
