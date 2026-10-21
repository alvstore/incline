import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, MapPin, Navigation, ShieldCheck, LocateFixed } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CLUB_LOCATION, isInsideClub } from "@/lib/registration/geoFence";
import inclineLogo from "@/assets/incline-logo.png";

type GeoState = "checking" | "inside" | "outside" | "denied" | "unsupported";
const STAFF_ROLES = ["owner", "admin", "manager", "staff"];

/** Registration opens only for people standing inside the club (or a signed-in desk account). */
export function InClubGate({ children }: { children: ReactNode }) {
  const { roles } = useAuth();
  const isDesk = roles.some((r) => STAFF_ROLES.includes(String(r.role)));
  const [state, setState] = useState<GeoState>("checking");

  const check = useCallback(() => {
    if (!("geolocation" in navigator)) return setState("unsupported");
    setState("checking");
    navigator.geolocation.getCurrentPosition(
      (p) => setState(isInsideClub({ lat: p.coords.latitude, lng: p.coords.longitude }, p.coords.accuracy) ? "inside" : "outside"),
      () => setState("denied"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => { if (!isDesk) check(); }, [check, isDesk]);

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
    checking: { title: "Checking you're at the club…", body: "Please allow location so we can confirm you're at Incline, Sector 14." },
    outside: { title: "Please visit the club to register", body: "Membership registration is completed in person at The Incline Life, Sector 14, Udaipur. Our front desk will welcome you and finish it in a few minutes." },
    denied: { title: "Location needed to register", body: "Registration is only available inside the club. Turn on location for this site and try again, or ask the front desk." },
    unsupported: { title: "Please visit the club to register", body: "This device can't confirm your location. Registration is completed in person at the club." },
  };
  const c = copy[state as Exclude<GeoState, "inside">];

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
        <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
        {state !== "checking" && (
          <div className="mt-6 grid gap-2">
            <a href={maps} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Navigation className="h-4 w-4" /> Directions to the club
            </a>
            <button type="button" onClick={check}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <LocateFixed className="h-4 w-4" /> I'm at the club — check again
            </button>
            <Link to="/auth" className="mt-1 inline-flex min-h-11 items-center justify-center text-xs text-muted-foreground hover:text-foreground">
              Already a member? Sign in
            </Link>
          </div>
        )}
      </motion.div>
    </div>
  );
}
