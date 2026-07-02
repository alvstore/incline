import { useEffect, useState } from "react";
import { X, Sparkles, ChevronRight } from "lucide-react";
import LaunchCountdown from "./LaunchCountdown";

const DISMISS_KEY = "incline.founding-chip.dismissed";

/**
 * Small floating glass pill anchored bottom-right. Nudges visitors toward
 * the existing RegisterModal without ever mentioning pricing (embargo SSOT).
 *
 * - Appears ~1.5s after mount, giving the hero a clean first paint.
 * - Skipped entirely under prefers-reduced-motion.
 * - Session-scoped dismissal — never re-nags the same session.
 */
const FoundingChip = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* sessionStorage blocked — fine, we just don't persist dismissal */
    }
    const t = window.setTimeout(() => setVisible(true), 1500);
    return () => window.clearTimeout(t);
  }, []);

  if (!visible) return null;

  const openRegister = () => {
    window.dispatchEvent(new CustomEvent("open-register-modal"));
  };

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVisible(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed z-40 bottom-4 right-4 md:bottom-6 md:right-6 animate-fade-in"
      role="complementary"
      aria-label="Founding Membership reservation"
    >
      <button
        type="button"
        onClick={openRegister}
        aria-label="Reserve your Founding Membership spot"
        className="group flex items-center gap-2 pl-3 pr-2 py-2 rounded-full bg-background/80 backdrop-blur-md border border-primary/30 shadow-lg shadow-primary/10 hover:shadow-primary/20 hover:border-primary/60 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        <Sparkles
          className="w-4 h-4 text-primary shrink-0"
          aria-hidden="true"
        />
        <span className="text-xs md:text-sm font-semibold text-foreground">
          <LaunchCountdown variant="chip" />
        </span>
        <span className="hidden sm:inline text-xs text-muted-foreground">
          · Reserve your spot
        </span>
        <ChevronRight
          className="w-4 h-4 text-primary transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
        <span
          role="button"
          tabIndex={0}
          onClick={dismiss}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              setVisible(false);
              try {
                sessionStorage.setItem(DISMISS_KEY, "1");
              } catch {
                /* ignore */
              }
            }
          }}
          aria-label="Dismiss"
          className="ml-1 p-1 rounded-full hover:bg-muted/60 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
        </span>
      </button>
    </div>
  );
};

export default FoundingChip;
