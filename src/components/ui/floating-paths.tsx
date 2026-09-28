import { motion, useReducedMotion } from "framer-motion";

/**
 * Kinetic background paths — pure SVG + framer-motion (transform/opacity only).
 * Used behind the /auth visual panel to suggest an upward incline.
 */
export function FloatingPaths({ position = 1 }: { position?: number }) {
  const reduce = useReducedMotion();

  const paths = Array.from({ length: 28 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${
      312 - i * 5 * position
    } ${216 - i * 6} ${152 - i * 5 * position} ${343 - i * 6}C${616 - i * 5 * position} ${
      470 - i * 6
    } ${684 - i * 5 * position} ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.035,
  }));

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg
        className="h-full w-full text-primary-foreground"
        viewBox="0 0 696 316"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={0.06 + path.id * 0.018}
            initial={{ pathLength: 0.3, opacity: 0.5 }}
            animate={
              reduce
                ? { pathLength: 1, opacity: 0.4 }
                : { pathLength: 1, opacity: [0.2, 0.5, 0.2], pathOffset: [0, 1, 0] }
            }
            transition={
              reduce
                ? { duration: 0 }
                : {
                    duration: 24 + (path.id % 7) * 2,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "linear",
                  }
            }
          />
        ))}
      </svg>
    </div>
  );
}

export default FloatingPaths;
