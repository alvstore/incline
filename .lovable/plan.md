# Plan: Landing Page Launch Updates

Update the landing page to reflect the post-launch status of Incline.

## User Review Required

> [!IMPORTANT]
> The current hero banner text is "WHERE GLOBAL STRENGTH MEETS CLINICAL SERENITY." and the sub-text mentions Rajasthan's new benchmark for excellence. Since you asked to replace the hero banner text, I will update it to a post-launch version. Please confirm if you have specific wording in mind.

- The footer will be removed from the landing page as requested.
- The "WE ARE OPEN" countdown/label will be removed.
- Unused files like `LaunchCountdown.tsx` and `FoundingChip.tsx` will be deleted.

## Proposed Changes

### Landing Page & Components

#### [src/pages/InclineAscent.tsx](src/pages/InclineAscent.tsx)
- Remove `FoundingChip` import and usage.
- Update hero `h1` and `p` text in the static SEO layer.
- Remove the "WE ARE OPEN" text if present.

#### [src/components/ui/ScrollOverlay.tsx](src/components/ui/ScrollOverlay.tsx)
- Remove `LaunchCountdown` import and usage.
- Update hero `h2` and `p` text to match the new version.
- Remove the `footer` section entirely.
- Remove the "Join Waitlist" section if it's no longer appropriate (replacing with a standard CTA).

#### [src/components/3d/Scene3D.tsx](src/components/3d/Scene3D.tsx)
- Remove `FoundingChip` from the render block.

### Cleanup

#### Deletions
- Delete `src/components/launch/LaunchCountdown.tsx`.
- Delete `src/components/launch/FoundingChip.tsx`.
- Delete `src/lib/launch.ts` if no longer used.

## Technical Details
- The new hero text will be: "EXPERIENCE THE PINNACLE OF STRENGTH & RECOVERY." (placeholder until confirmed).
- The sub-text will be updated to: "Now open in Udaipur. Experience Rajasthan's premier fitness destination featuring Italian Panatta biomechanics and clinical recovery suites."
- Hiding the Lovable badge was already performed in a previous turn via CSS, but I will ensure no layout regressions occur during the footer removal.

## Footnotes
- All SEO metadata remains optimized for the Sector 14, Udaipur location.
- 3D performance optimizations (lazy loading, idle mounting) are preserved.
