import { MapPin } from "lucide-react";
import heroImg from "@/assets/auth-hero-athlete.jpg";

const PILLARS = ["Rise", "Reflect", "Repeat"];

/** Inset photo panel for /auth — always dark-scrimmed so chips stay readable. */
export function AuthVisualPanel() {
  return (
    <aside
      className="group relative isolate h-44 overflow-hidden rounded-3xl bg-sidebar-accent sm:h-52 lg:h-full lg:min-h-[560px]"
      aria-label="The Incline Life"
    >
      <img
        src={heroImg}
        alt="Athlete lifting at The Incline Life, Udaipur"
        width={1024}
        height={1280}
        className="absolute inset-0 h-full w-full object-cover object-[50%_30%] transition-transform duration-300 ease-out group-hover:scale-[1.03]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/30 to-transparent" aria-hidden="true" />
      <div className="relative flex h-full flex-col justify-end gap-3 p-4 sm:p-6">
        <ul className="flex flex-wrap gap-2" aria-label="Rise. Reflect. Repeat.">
          {PILLARS.map((p) => (
            <li key={p} className="rounded-full border border-sidebar-foreground/20 bg-sidebar/70 px-3 py-1 text-xs font-semibold text-sidebar-foreground backdrop-blur-sm">
              {p}.
            </li>
          ))}
        </ul>
        <p className="hidden items-center gap-1.5 text-xs text-sidebar-foreground/85 sm:flex">
          <MapPin className="h-3.5 w-3.5" /> Sector 14, Udaipur
        </p>
      </div>
    </aside>
  );
}

export default AuthVisualPanel;
