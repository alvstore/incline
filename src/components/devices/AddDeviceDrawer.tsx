import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { addDevice } from "@/services/deviceService";
import { Loader2, Fingerprint } from "lucide-react";

interface AddDeviceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  defaultBranchId?: string;
}

const AddDeviceDrawer = ({ isOpen, onClose, branches, defaultBranchId }: AddDeviceDrawerProps) => {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    device_name: "",
    serial_number: "",
    branch_id: defaultBranchId || "",
    model: "",
  });

  const addMutation = useMutation({
    mutationFn: addDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-devices"] });
      queryClient.invalidateQueries({ queryKey: ["mips-devices"] });
      toast.success("Device added successfully");
      onClose();
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(`Failed to add device: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFormData({
      device_name: "",
      serial_number: "",
      branch_id: defaultBranchId || "",
      model: "",
    });
  };

  useEffect(() => {
    setFormData((prev) => ({ ...prev, branch_id: defaultBranchId || "" }));
  }, [defaultBranchId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.device_name.trim()) { toast.error("Device name is required"); return; }
    if (!formData.serial_number.trim()) { toast.error("Serial Number is required"); return; }
    if (!formData.branch_id) { toast.error("Please select a branch"); return; }

    addMutation.mutate({
      branch_id: formData.branch_id,
      device_name: formData.device_name.trim(),
      serial_number: formData.serial_number.trim().toUpperCase(),
      device_type: "face_terminal",
      model: formData.model.trim() || undefined,
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Access Device</SheetTitle>
          <SheetDescription>Register a device and configure its MIPS server connection</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          <div className="space-y-2">
            <Label htmlFor="device_name">Device Name *</Label>
            <Input id="device_name" placeholder="e.g., Main Entrance Terminal" value={formData.device_name} onChange={(e) => setFormData({ ...formData, device_name: e.target.value })} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="serial_number">Device Serial Number (SN) *</Label>
            <Input id="serial_number" placeholder="e.g., D1146D682A96B1C2" value={formData.serial_number} onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })} />
            <p className="text-xs text-muted-foreground">Must match the SN registered on the MIPS server</p>
          </div>

          <div className="space-y-2">
            <Label>Branch *</Label>
            <Select value={formData.branch_id} onValueChange={(value) => setFormData({ ...formData, branch_id: value })}>
              <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (<SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Input placeholder="e.g., SMDT-X1" value={formData.model} onChange={(e) => setFormData({ ...formData, model: e.target.value })} />
          </div>

          <Separator />

          <Alert className="border-info/25 bg-info/10 dark:border-info dark:bg-info/30">
            <Fingerprint className="h-4 w-4 text-info" />
            <AlertDescription className="text-sm text-info dark:text-info">
              Fingerprints cannot be captured via the web browser. Please register fingerprints directly on the physical gym terminal.
            </AlertDescription>
          </Alert>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={addMutation.isPending} className="flex-1">
              {addMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Device
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default AddDeviceDrawer;
