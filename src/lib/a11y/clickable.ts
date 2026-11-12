import type { KeyboardEvent } from 'react';

/**
 * Keyboard twin for clickable non-button elements (cards, rows, tiles).
 * Enter / Space trigger the element's own onClick, so there is exactly one
 * handler to maintain. Keys pressed on inner controls (buttons, inputs) are
 * ignored, so nested actions keep their own behaviour.
 */
export function clickOnActivateKey(e: KeyboardEvent<HTMLElement>): void {
  if (e.target !== e.currentTarget) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.currentTarget.click();
}

/** Focus ring shared by clickable cards/rows so keyboard users can see where they are. */
export const CLICKABLE_FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';
