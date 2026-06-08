// Add / edit a HOWBODY scanner device. Right-side Sheet (project standard).
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Trash2 } from "lucide-react";
import { useBranches } from "@/hooks/useBranches";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  createHowbodyDevice,
  updateHowbodyDevice,
  deleteHowbodyDevice,
  type HowbodyDevice,
} from "@/services/howbodyDeviceService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: HowbodyDevice | null;
}

const NO_BRANCH = "__none__";

export function HowbodyDeviceDrawer({ open, onOpenChange, device }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: branches = [] } = useBranches();
  const isEdit = !!device;

  const [equipmentNo, setEquipmentNo] = useState("");
  const [label, setLabel] = useState("");
  const [location, setLocation] = useState("");
  const [branchId, setBranchId] = useState<string>(NO_BRANCH);
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEquipmentNo(device?.equipment_no ?? "");
    setLabel(device?.label ?? "");
    setLocation(device?.location ?? "");
    setBranchId(device?.branch_id ?? NO_BRANCH);
    setNotes(device?.notes ?? "");
    setIsActive(device?.is_active ?? true);
  }, [open, device]);

  async function handleSave() {
    const trimmed = equipmentNo.trim();
    if (!trimmed) {
      toast({ title: "Equipment No. required", description: "Enter the device serial (e.g. HD0202501821).", variant: "destructive" });
      return;
    }
    if (trimmed.length > 64) {
      toast({ title: "Equipment No. too long", description: "Max 64 characters.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        equipment_no: trimmed,
        branch_id: branchId === NO_BRANCH ? null : branchId,
        label: label || null,
        location: location || null,
        notes: notes || null,
        is_active: isActive,
      };
      if (isEdit && device) {
        await updateHowbodyDevice(device.id, payload);
        toast({ title: "Device updated" });
      } else {
        await createHowbodyDevice(payload);
        toast({ title: "Device added", description: `${trimmed} is now registered.` });
      }
      await qc.invalidateQueries({ queryKey: ["howbody-devices"] });
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.message?.includes("duplicate") || e?.code === "23505"
        ? "A device with this Equipment No. already exists."
        : (e?.message || "Save failed.");
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!device) return;
    if (!confirm(`Delete device ${device.equipment_no}? Past scan reports will keep their snapshot of this serial.`)) return;
    setDeleting(true);
    try {
      await deleteHowbodyDevice(device.id);
      await qc.invalidateQueries({ queryKey: ["howbody-devices"] });
      toast({ title: "Device deleted" });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit Body Scanner Device" : "Add Body Scanner Device"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update the device label, branch assignment, or active status."
              : "Register a HOWBODY scanner so reports can be tagged to the correct branch."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div>
            <Label htmlFor="hb-eq">Equipment No. (Serial) *</Label>
            <Input
              id="hb-eq"
              value={equipmentNo}
              onChange={(e) => setEquipmentNo(e.target.value)}
              placeholder="HD0202501821"
              className="mt-1 font-mono"
              disabled={isEdit}
              maxLength={64}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Printed on the back of the device. Cannot be changed after creation.
            </p>
          </div>

          <div>
            <Label htmlFor="hb-label">Friendly Label</Label>
            <Input
              id="hb-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="HOWBODY S580 — Main Studio"
              className="mt-1"
              maxLength={120}
            />
          </div>

          <div>
            <Label htmlFor="hb-loc">Location</Label>
            <Input
              id="hb-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Floor 2, Cardio Zone"
              className="mt-1"
              maxLength={120}
            />
          </div>

          <div>
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BRANCH}>Unassigned</SelectItem>
                {branches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="hb-notes">Notes</Label>
            <Textarea
              id="hb-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — maintenance notes, install date, vendor contact…"
              className="mt-1"
              rows={3}
              maxLength={500}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-muted p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Disable to stop accepting scans from this device.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1 bg-primary hover:bg-primary">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {isEdit ? "Save changes" : "Add device"}
            </Button>
            {isEdit && (
              <Button variant="outline" onClick={handleDelete} disabled={deleting} className="text-destructive hover:bg-destructive/10">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
