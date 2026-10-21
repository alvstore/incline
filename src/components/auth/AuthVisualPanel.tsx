import { MapPin } from "lucide-react";
import inclineLogo from "@/assets/incline-logo.png";
import riseImg from "@/assets/auth-rise.jpg";
import { GlassFolderCards } from './GlassFolderCards';

/**
 * Left-side brand panel for /auth. Always dark (sidebar tokens) in both themes,
 * so the white logo keeps contrast and nothing flips colour on load.
 */
export function AuthVisualPanel() {
  return (
    <aside className="auth-visual absolute inset-0 isolate overflow-hidden bg-sidebar text-sidebar-foreground" aria-label="The Incline Life">
      {/* Phone: photo strip behind the logo */}
      <img src={riseImg} alt="" width={768} height={1024} className="absolute inset-0 h-full w-full object-cover opacity-50 lg:hidden" />
      <div className="absolute inset-0 bg-gradient-to-r from-sidebar via-sidebar/80 to-sidebar/30 lg:hidden" aria-hidden="true" />
      <div className="relative flex h-full flex-col justify-between gap-6 p-5 sm:p-8 lg:p-12">
        <div className="flex items-center justify-between gap-4">
          <img src={inclineLogo} alt="Incline — Rise. Reflect. Repeat." width={200} height={100} className="h-12 w-auto object-contain lg:h-16" />
          <span className="text-right text-xs leading-tight text-sidebar-foreground/85 lg:hidden">Rise. Reflect. Repeat.<br />Udaipur, Rajasthan</span>
        </div>
        <div className="hidden lg:block">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-sidebar-primary">Fitness · Recovery · Progress</p>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">The Incline Life.</h2>
          <p className="mt-3 max-w-md text-sm text-sidebar-foreground/80">Rise. Reflect. Repeat. — Udaipur's luxury fitness and recovery club.</p>
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
