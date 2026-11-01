/** Viewport-relative framing keeps the object in the space reserved by the copy. */
export function dumbbellPose(progress: number, width: number, height: number, compact: boolean) {
  const p = Math.max(0, Math.min(1, progress));
  const segment = Math.min(3, Math.floor(p * 4));
  const t = p * 4 - segment;
  const eased = t * t * (3 - 2 * t);
  const sides = [-1, 1, -1, 1, -1];
  const side = sides[segment] + (sides[segment + 1] - sides[segment]) * eased;
  return {
    x: compact ? -width * 0.33 : side * width * 0.25,
    y: 0,
    scale: compact ? Math.min(width * 0.15, height * 0.16) : Math.min(width * 0.18, height * 0.24, 1.45),
    rotation: Math.PI / 3 + Math.sin(p * Math.PI * 4) * 0.18,
    spread: Math.sin(p * Math.PI) * 0.12,
  };
}