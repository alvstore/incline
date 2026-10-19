import { MapPin } from "lucide-react";
import inclineLogo from "@/assets/incline-logo.png";
import { GlassFolderCards } from './GlassFolderCards';

/**
 * Left-side brand panel for /auth.
 * Motion is transform/opacity only and respects prefers-reduced-motion.
 */
export function AuthVisualPanel() {
  return (
    <aside className="auth-visual absolute inset-0 isolate overflow-hidden bg-sidebar text-sidebar-foreground" aria-label="The Incline Life">
      <div className="flex h-full flex-col justify-between gap-6 p-6 sm:p-8 lg:p-12">
        <div className="flex items-center justify-between gap-4">
          <img src={inclineLogo} alt="Incline — Rise. Reflect. Repeat." width={200} height={100} className="h-12 w-auto object-contain lg:h-16" />
          <span className="text-xs text-sidebar-foreground/80 lg:hidden">Udaipur, Rajasthan</span>
        </div>
        <div className="hidden lg:block">
          <p className="mb-4 text-xs font-medium uppercase text-sidebar-foreground/80">Fitness · Recovery · Progress</p>
          <h2 className="text-4xl font-semibold leading-tight xl:text-5xl">The Incline Life.</h2>
          <GlassFolderCards />
        </div>
        <div className="hidden items-center gap-2 text-xs text-sidebar-foreground/80 lg:flex">
          <MapPin className="h-4 w-4" /><span>Sector 14, Udaipur · The Incline Life by Incline</span>
        </div>
      </div>
    </aside>
  );
}

export default AuthVisualPanel;
