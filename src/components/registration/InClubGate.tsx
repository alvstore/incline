import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, MapPin, Navigation, ShieldCheck, LocateFixed, Settings2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CLUB_LOCATION, isInsideClub } from "@/lib/registration/geoFence";
import inclineLogo from "@/assets/incline-logo.png";

type GeoState = "intro" | "checking" | "inside" | "outside" | "denied" | "timeout" | "unsupported";
const STAFF_ROLES = ["owner", "admin", "manager", "staff"];

const isIOS = typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Registration opens only for people standing inside the club (or a signed-in desk account). */
export function InClubGate({ children }: { children: ReactNode }) {
  const { roles } = useAuth();
  const isDesk = roles.some((r) => STAFF_ROLES.includes(String(r.role)));
  const [state, setState] = useState<GeoState>("intro");

  const locate = useCallback((highAccuracy: boolean) => {
    navigator.geolocation.getCurrentPosition(
      (p) => setState(isInsideClub({ lat: p.coords.latitude, lng: p.coords.longitude }, p.coords.accuracy) ? "inside" : "outside"),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) return setState("denied");
        // Indoors GPS often times out on iPhone — retry once with Wi-Fi/cell positioning.
        if (highAccuracy) return locate(false);
        setState("timeout");
      },
      { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 12_000 : 20_000, maximumAge: 0 },
    );
  }, []);

  // Must run from a tap: iOS Safari only shows its permission prompt reliably on a user gesture.
  const check = useCallback(() => {
    if (!("geolocation" in navigator) || !window.isSecureContext) return setState("unsupported");
    setState("checking");
    locate(true);
  }, [locate]);

  // If permission was already granted earlier, check silently on load.
  useEffect(() => {
    if (isDesk) return;
    navigator.permissions?.query({ name: "geolocation" as PermissionName })
      .then((s) => { if (s.state === "granted") check(); if (s.state === "denied") setState("denied"); })
      .catch(() => undefined);
  }, [check, isDesk]);

  if (isDesk || state === "inside") {
    return (
      <>
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-success/30 bg-success/15 px-3 py-1 text-xs font-semibold text-success backdrop-blur">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />{isDesk ? "Front desk registration" : "Verified at the club · Sector 14"}</span>
        </div>
        {children}
      </>
    );
  }

  const maps = `https://www.google.com/maps/dir/?api=1&destination=${CLUB_LOCATION.lat},${CLUB_LOCATION.lng}`;
  const copy: Record<Exclude<GeoState, "inside">, { title: string; body: string }> = {
    intro: { title: "Confirm you're at the club", body: "Registration is completed inside The Incline Life, Sector 14. Tap below and choose “Allow” when your phone asks for location." },
    checking: { title: "Finding your location…", body: "This can take up to 20 seconds indoors. Keep this page open." },
    outside: { title: "Please visit the club to register", body: "Membership registration is completed in person at The Incline Life, Sector 14, Udaipur. Our front desk will finish it in a few minutes." },
    denied: { title: "Location is turned off for this site", body: "Turn it on using the steps below, then tap “Try again”." },
    timeout: { title: "Couldn't get your location", body: "Your phone didn't return a location in time. Move near the entrance or a window, check Location is on, then try again." },
    unsupported: { title: "Location isn't available", body: "This browser can't share location. Open theincline.in/register in Safari or Chrome, or ask the front desk." },
  };
  const c = copy[state as Exclude<GeoState, "inside">];
  const showSteps = state === "denied" || state === "timeout";

  const steps = isIOS
    ? [
        "Open the iPhone Settings app → Privacy & Security → Location Services → make sure it's ON.",
        "In the same list, tap Safari Websites → choose “While Using the App” and turn on Precise Location.",
        "Back in Safari, tap the “aA” (or page menu) in the address bar → Website Settings → Location → Allow.",
        "Return here and tap “Try again”. If it still fails, close the tab and reopen theincline.in/register.",
      ]
    : [
        "Tap the lock/settings icon next to the address bar → Permissions → Location → Allow.",
        "Make sure your phone's Location (GPS) is switched ON in quick settings.",
        "Return here and tap “Try again”.",
      ];

  return (
    <div className="dark flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center sm:p-8"
      >
        <img src={inclineLogo} alt="Incline" className="mx-auto h-14 w-auto" />
        <div className="relative mx-auto my-6 flex h-20 w-20 items-center justify-center">
          {state === "checking" && (
            <motion.span className="absolute inset-0 rounded-full bg-primary/20"
              animate={{ scale: [1, 1.6], opacity: [0.6, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />
          )}
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
            {state === "checking" ? <Loader2 className="h-7 w-7 animate-spin" /> : <MapPin className="h-7 w-7" />}
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{c.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">{c.body}</p>

        {showSteps && (
          <div className="mt-5 rounded-2xl border border-border bg-muted/40 p-4 text-left">
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Settings2 className="h-3.5 w-3.5" /> {isIOS ? "On iPhone / iPad" : "On your phone"}
            </p>
            <ol className="space-y-2 text-sm">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{i + 1}</span>
                  <span className="text-foreground/90">{s}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">Still stuck? Ask the front desk — they can register you from the desk login.</p>
          </div>
        )}

        {state !== "checking" && (
          <div className="mt-6 grid gap-2">
            {state !== "unsupported" && (
              <button type="button" onClick={check}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <LocateFixed className="h-4 w-4" /> {state === "intro" ? "Allow location & continue" : "Try again"}
              </button>
            )}
            {state === "outside" && (
              <a href={maps} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Navigation className="h-4 w-4" /> Directions to the club
              </a>
            )}
            <Link to="/auth" className="mt-1 inline-flex min-h-11 items-center justify-center text-xs text-muted-foreground hover:text-foreground">
              Already a member? Sign in
            </Link>
          </div>
        )}
      </motion.div>
    </div>
  );
}
