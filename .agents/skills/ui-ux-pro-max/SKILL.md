---
name: ui-ux-pro-max
description: AI-powered design intelligence — 67 UI styles, 161 palettes, 57 font pairings, 99 UX guidelines, and 25 chart patterns across 15+ stacks. Use when redesigning or polishing UI, picking a color/typography system, choosing a layout pattern, or auditing a screen for UX/accessibility issues.
---

# UI/UX Pro Max

Local design intelligence powered by a Python CLI over curated CSV databases.

## Setup

The skill ships with `scripts/*.py` and `assets/data/*.csv`. The script reads CSVs from a `data/` directory next to it, so before running, copy both to `/tmp` (sandbox rule: only scripts under `knowledge://` can be exec'd, and only after `code--copy`):

```bash
mkdir -p /tmp/uupm && \
cp .agents/skills/ui-ux-pro-max/scripts/*.py /tmp/uupm/ && \
cp -r .agents/skills/ui-ux-pro-max/assets/data /tmp/uupm/data && \
python3 /tmp/uupm/search.py --help
```

## Core workflow

1. **Design system** (start here for any redesign):
   ```bash
   python3 /tmp/uupm/search.py "<product type + keywords>" --design-system -p "<Project>" --stack react
   ```
   Returns a recommended pattern, style, color palette, typography pair, key effects, and anti-patterns.

2. **Domain search** (narrow lookups):
   ```bash
   python3 /tmp/uupm/search.py "<query>" --domain <style|color|typography|landing|chart|ux|product>
   ```

3. **Stack-specific guidance**:
   ```bash
   python3 /tmp/uupm/search.py "<query>" --stack <react|shadcn|nextjs|...>
   ```

## When to use

- Redesign or polish an existing screen ("make this prettier / more premium / Awwwards-level")
- Pick a palette, font pair, or layout pattern for a new feature
- Audit a screen against UX/accessibility guidelines
- Decide which chart to use for a given data shape

## Project guardrails

This project is locked to the **Vuexy** design system (Indigo/Violet, Inter, `rounded-2xl`, soft slate shadows). Use UUPM output for **composition, hierarchy, density, motion, and pattern selection** — but keep raw color tokens, typography, and radii aligned with the project's existing tokens unless explicitly told otherwise.
