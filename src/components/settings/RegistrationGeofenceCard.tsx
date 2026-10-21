import { useState } from "react";
import { MapPin, MapPinOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useGeofenceDetail, useSetGeofence } from "@/lib/registration/useGeofenceSetting";
import { GeofenceOffDialog } from "@/components/registration/GeofenceOffDialog";

const ADMIN = ["owner", "admin", "manager"];

export function RegistrationGeofenceCard() {
  const { roles } = useAuth();
  const canEdit = roles.some((r) => ADMIN.includes(String(r.role)));
  const { data, isLoading, isError } = useGeofenceDetail(canEdit);
  const setGeo = useSetGeofence();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!canEdit) return null;
  const on = data?.effective !== false;

  const turnOn = () =>
    setGeo.mutate({ enabled: true, disabledUntil: null }, {
      onSuccess: () => toast.success("Location check is back on"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
    });

  const until = data?.disabled_until ? new Date(data.disabled_until) : null;
  const changed = data?.updated_at ? new Date(data.updated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          {on ? <MapPin className="h-5 w-5 text-primary" /> : <MapPinOff className="h-5 w-5 text-destructive" />}
          <CardTitle className="text-base">Registration location check</CardTitle>
        </div>
        <CardDescription>Turn off in an emergency (for example, phones can't share location) so walk-ins can register quickly.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? <Skeleton className="h-14 w-full" /> : isError ? (
          <p className="text-sm text-destructive">Couldn't load this setting. Refresh to try again.</p>
        ) : (
          <>
            <div className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-border p-4">
              <div>
                <Label htmlFor="geo-switch" className="text-sm font-semibold">
                  {on ? "On: only people at the club can register" : "Off: anyone with the link can register"}
                </Label>
                <p id="geo-help" className="text-xs text-muted-foreground" aria-live="polite">
                  {on ? "Members must allow location and be within 200 m of Sector 14."
                    : until ? `Turns back on automatically at ${until.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short", dateStyle: "medium" })}.`
                    : "Stays off until someone turns it back on."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {setGeo.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
                <Switch id="geo-switch" aria-describedby="geo-help" checked={on} disabled={setGeo.isPending}
                  onCheckedChange={(v) => (v ? turnOn() : setConfirmOpen(true))} />
              </div>
            </div>
            {changed && (
              <p className="text-xs text-muted-foreground">Last changed {changed}{data?.updated_by_name ? ` by ${data.updated_by_name}` : ""}</p>
            )}
          </>
        )}
      </CardContent>
      <GeofenceOffDialog open={confirmOpen} onOpenChange={setConfirmOpen} />
    </Card>
  );
}
