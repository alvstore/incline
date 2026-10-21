import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSetGeofence } from "@/lib/registration/useGeofenceSetting";

type Dur = "1h" | "today" | "never";

function untilFor(d: Dur): string | null {
  if (d === "never") return null;
  if (d === "1h") return new Date(Date.now() + 3_600_000).toISOString();
  // End of today in IST (23:59:59 +05:30)
  const ist = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  return new Date(`${ist}T23:59:59+05:30`).toISOString();
}

export function GeofenceOffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [dur, setDur] = useState<Dur>("today");
  const setGeo = useSetGeofence();
  const opts: { v: Dur; l: string }[] = [
    { v: "1h", l: "For 1 hour" }, { v: "today", l: "Until end of today" }, { v: "never", l: "Until I turn it back on" },
  ];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Turn off the location check?</AlertDialogTitle>
          <AlertDialogDescription>Registration will open for anyone with the link, not only people at the club.</AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup value={dur} onValueChange={(v) => setDur(v as Dur)} aria-label="Turn back on automatically" className="gap-1">
          {opts.map((o) => (
            <div key={o.v} className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-secondary">
              <RadioGroupItem id={`geo-${o.v}`} value={o.v} />
              <Label htmlFor={`geo-${o.v}`} className="flex-1 cursor-pointer text-sm">{o.l}</Label>
            </div>
          ))}
        </RadioGroup>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it on</AlertDialogCancel>
          <AlertDialogAction
            disabled={setGeo.isPending}
            onClick={() => setGeo.mutate({ enabled: false, disabledUntil: untilFor(dur) }, {
              onSuccess: () => toast.success("Location check turned off"),
              onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
            })}
          >Turn off</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
