import { useState } from "react";
import { ArrowUpRight, Repeat, Snowflake, MapPin } from "lucide-react";
import inclineLogo from "@/assets/incline-logo.png";
import { FloatingPaths } from "@/components/ui/floating-paths";

const PILLARS = [
  {
    icon: ArrowUpRight,
    title: "Rise",
    copy: "Panatta strength floor, personal training and group energy.",
  },
  {
    icon: Snowflake,
    title: "Reflect",
    copy: "Infrared sauna, steam and cold plunge recovery suite.",
  },
  {
    icon: Repeat,
    title: "Repeat",
    copy: "3D body scans and progress tracking that keep you consistent.",
  },
];

/**
 * Left-side brand panel for /auth.
 * Motion is transform/opacity only and respects prefers-reduced-motion.
 */
export function AuthVisualPanel() {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <aside
      aria-hidden="true"
      className="auth-visual absolute inset-0 overflow-hidden text-primary-foreground"
    >
      {/* Base gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(at 18% 12%, hsl(258 90% 40% / 0.85) 0%, transparent 55%), radial-gradient(at 85% 78%, hsl(226 90% 45% / 0.7) 0%, transparent 52%), linear-gradient(140deg, hsl(229 45% 7%) 0%, hsl(241 60% 12%) 55%, hsl(224 70% 16%) 100%)",
        }}
      />

      {/* Kinetic paths */}
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />

      {/* Soft vignette for text contrast */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/25" />

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col justify-between p-6 sm:p-10 lg:p-14">
        {/* Logo lockup */}
        <div className="flex items-center gap-3">
          {!logoFailed ? (
            <img
              src={inclineLogo}
              alt="Incline"
              onError={() => setLogoFailed(true)}
              className="h-10 lg:h-14 w-auto object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
            />
          ) : (
            <div className="leading-tight">
              <div className="font-oswald font-extrabold text-2xl tracking-tight">INCLINE</div>
              <div className="text-primary-foreground/60 text-[11px] tracking-[0.3em] uppercase">
                Rise. Reflect. Repeat.
              </div>
            </div>
          )}
        </div>

        {/* Headline + pillars */}
        <div className="hidden lg:block max-w-lg space-y-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-primary-foreground/60">
              The Incline Life
            </p>
            <h2 className="font-oswald font-bold text-4xl xl:text-5xl leading-[1.05] tracking-tight">
              Rise. Reflect.
              <br />
              <span className="text-primary-foreground/70">Repeat.</span>
            </h2>
            <p className="text-primary-foreground/75 text-base leading-relaxed">
              Your membership, classes, recovery sessions and progress — all in one place.
            </p>
          </div>

          <ul className="space-y-4">
            {PILLARS.map(({ icon: Icon, title, copy }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="mt-0.5 h-9 w-9 shrink-0 rounded-xl bg-primary-foreground/10 border border-primary-foreground/15 grid place-items-center backdrop-blur-sm">
                  <Icon className="h-4 w-4 text-primary-foreground" />
                </span>
                <div>
                  <p className="text-sm font-semibold tracking-wide">{title}</p>
                  <p className="text-sm text-primary-foreground/65 leading-relaxed">{copy}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="hidden lg:flex items-center gap-2 text-xs text-primary-foreground/60">
          <MapPin className="h-3.5 w-3.5" />
          <span>Sector 14, Udaipur · The Incline Life by Incline</span>
        </div>
      </div>
    </aside>
  );
}

export default AuthVisualPanel;
