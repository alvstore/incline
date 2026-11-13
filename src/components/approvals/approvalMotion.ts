import { useLayoutEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Runs once on mount: cards rise in, title letters reveal. Never replays for live data. */
export function usePageEntrance(scope: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    if (!scope.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-anim="char"]', { yPercent: 115, rotation: 6, duration: 0.85, ease: 'power4.out', stagger: 0.022, clearProps: 'transform' });
      gsap.from('[data-anim="card"]', { opacity: 0, y: 26, scale: 0.985, duration: 0.8, ease: 'expo.out', stagger: 0.06, delay: 0.1, clearProps: 'opacity,transform' });
    }, scope);
    return () => ctx.revert();
  }, [scope]);
}

/** Animates newly-keyed rows only (key change = new list, e.g. tab switch). */
export function useRowsEntrance(scope: RefObject<HTMLElement>, key: string) {
  useLayoutEffect(() => {
    if (!scope.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-anim="row"]', { opacity: 0, y: 12, duration: 0.55, ease: 'power3.out', stagger: 0.04, clearProps: 'opacity,transform' });
    }, scope);
    return () => ctx.revert();
  }, [scope, key]);
}

export function useCountUp(value: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) { el.textContent = String(value); last.current = value; return; }
    const obj = { v: last.current };
    const t = gsap.to(obj, { v: value, duration: 1.2, ease: 'power3.out', onUpdate: () => { el.textContent = String(Math.round(obj.v)); } });
    last.current = value;
    return () => { t.kill(); };
  }, [value]);
  return ref;
}

