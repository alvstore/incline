# Install 4 bundles from alirezarezvani/claude-skills

## Source

Cloned `https://github.com/alirezarezvani/claude-skills` (depth 1). Skill inventory in the four requested bundles:

| Bundle | Folder | SKILL.md count |
|---|---|---|
| Engineering — Core | `engineering-team/` | 50 |
| Product | `product-team/` | 17 |
| Marketing | `marketing-skill/` + top-level `marketing/landing` | 47 |
| Productivity ✨v2.7.0 | `productivity/` | 4 |
| **Total** | | **118** |

(Note: some engineering skills ship as `.zip` archives alongside identical unzipped versions under `engineering-team/skills/`. The unzipped copies are what get installed — no archive extraction needed; total active skill folders is **118**.)

## Steps

1. **Stage every skill into `.agents/skills/<name>/`**
   - Walk each bundle, locate every directory containing a `SKILL.md`.
   - Copy the entire skill directory (including `references/`, `scripts/`, `assets/`) to `.agents/skills/<skill-name>/`.
   - On name collisions with already-installed skills (e.g. `email-sequence`, `onboarding-cro`, `social-content`, `landing-page-generator`, `landing`), prefix the incoming skill with `cs-` (claude-skills) to keep both copies and let retrieval pick.
   - Skip any folder that is purely a bundle README without a `SKILL.md`.

2. **Validate each SKILL.md frontmatter**
   - Confirm `name:` and `description:` are present.
   - Patch missing `name:` to match the directory name; flag any skill with no description in a short report (not blocking install).

3. **Apply each draft via `skills--apply_draft`**
   - Call `skills--apply_draft` once per `.agents/skills/<name>` directory (118 calls, batched).
   - Each apply updates `skills-lock.json` automatically — no manual lockfile edit.

4. **Post-install report**
   - Print a table grouped by bundle: skill name → status (applied / skipped / renamed).
   - Note total count, collisions renamed, and any frontmatter fixes.

## Technical details

- All writes confined to `.agents/skills/`. No source-code changes, no migrations, no edge functions touched.
- Copy via `cp -R` (preserves nested `references/scripts/assets`).
- Renamed collisions: each `cs-<name>` skill keeps original `SKILL.md` body; only the directory and the `name:` frontmatter field are renamed.
- Bulk apply is sequential by tool contract (one apply per call) — expect ~118 tool calls in the implementation step.

## Caveat (please acknowledge)

Activating 118 skills means retrieval has a much larger pool to match against on every turn. Most of these (e.g. `senior-computer-vision`, `snowflake-development`, `apple-hig-expert`, `aws-solution-architect`, `kubernetes-operator` adjacents) are unrelated to a gym SaaS and will mostly sit idle. If retrieval ever surfaces an off-topic skill, you can prune individual ones from `Settings → Skills` later.

Approve to proceed with the full 118-skill install.
