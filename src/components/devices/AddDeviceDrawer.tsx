import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { addDevice } from "@/services/deviceService";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Fingerprint, Server, CheckCircle, XCircle } from "lucide-react";

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

  const [mipsConfig, setMipsConfig] = useState({
    server_url: "",
    username: "",
    password: "",
  });

  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Load existing MIPS connection for selected branch
  const { data: existingConnection } = useQuery({
    queryKey: ["mips-connection", formData.branch_id],
    queryFn: async () => {
      if (!formData.branch_id) return null;
      const { data } = await supabase
        .from("mips_connections_safe" as any)
        .select("*")
        .eq("branch_id", formData.branch_id)
        .maybeSingle();
      return data;
    },
    enabled: !!formData.branch_id,
  });

  useEffect(() => {
    const conn = existingConnection as any;
    if (conn) {
      setMipsConfig({
        server_url: conn.server_url || "",
        username: conn.username || "",
        password: "",
      });
    } else {
      setMipsConfig({ server_url: "", username: "", password: "" });
    }
    setTestResult(null);
  }, [existingConnection, formData.branch_id]);

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

  const saveMipsConnection = useMutation({
    mutationFn: async () => {
      if (!formData.branch_id || !mipsConfig.server_url) return;
      const payload: Record<string, unknown> = {
        branch_id: formData.branch_id,
        server_url: mipsConfig.server_url.replace(/\/+$/, ""),
        username: mipsConfig.username,
        is_active: true,
      };
      if (mipsConfig.password) {
        payload.password = mipsConfig.password;
      }

      const conn = existingConnection as any;
      if (conn) {
        const { error } = await supabase
          .from("mips_connections")
          .update(payload as any)
          .eq("id", conn.id);
        if (error) throw error;
      } else {
        if (!mipsConfig.password) throw new Error("Password required for new connection");
        payload.password = mipsConfig.password;
        const { error } = await supabase
          .from("mips_connections")
          .insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mips-connection"] });
      toast.success("MIPS server connection saved");
    },
    onError: (error: Error) => {
      toast.error(`Failed to save MIPS connection: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFormData({
      device_name: "",
      serial_number: "",
      branch_id: defaultBranchId || "",
      model: "",
    });
    setMipsConfig({ server_url: "", username: "", password: "" });
    setTestResult(null);
  };

  useEffect(() => {
    setFormData((prev) => ({ ...prev, branch_id: defaultBranchId || "" }));
  }, [defaultBranchId]);

  const handleTestConnection = async () => {
    if (!mipsConfig.server_url) {
      toast.error("Enter a server URL first");
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const url = mipsConfig.server_url.replace(/\/+$/, "");
      const loginRes = await supabase.functions.invoke("mips-proxy", {
        body: {
          endpoint: "/through/device/list",
          method: "GET",
          branch_id: formData.branch_id || undefined,
        },
      });
      if (loginRes.error) {
        setTestResult({ success: false, message: loginRes.error.message });
      } else {
        const d = loginRes.data as any;
        const ok = d?.success && (d?.data?.code === 200 || d?.data?.code === 0);
        setTestResult({
          success: ok,
          message: ok ? `Connected! Found ${d?.data?.total || 0} device(s)` : (d?.data?.msg || d?.error || "Connection failed"),
        });
      }
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.device_name.trim()) { toast.error("Device name is required"); return; }
    if (!formData.serial_number.trim()) { toast.error("Serial Number is required"); return; }
    if (!formData.branch_id) { toast.error("Please select a branch"); return; }

    // Save MIPS connection if configured
    if (mipsConfig.server_url && mipsConfig.username) {
      saveMipsConnection.mutate();
    }

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

          {/* MIPS Server Connection */}
          <Card className="rounded-xl border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                MIPS Server Connection
                {existingConnection && (
                  <span className="text-[10px] text-muted-foreground font-normal">(configured)</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Server URL (with port) *</Label>
                <Input
                  placeholder="http://212.38.94.228:9000"
                  value={mipsConfig.server_url}
                  onChange={(e) => setMipsConfig({ ...mipsConfig, server_url: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Username *</Label>
                  <Input
                    placeholder="admin"
                    value={mipsConfig.username}
                    onChange={(e) => setMipsConfig({ ...mipsConfig, username: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password *</Label>
                  <Input
                    type="password"
                    placeholder="••••••"
                    value={mipsConfig.password}
                    onChange={(e) => setMipsConfig({ ...mipsConfig, password: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={isTesting || !mipsConfig.server_url}
                >
                  {isTesting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Server className="h-3.5 w-3.5 mr-1.5" />}
                  Test Connection
                </Button>
                {mipsConfig.server_url && mipsConfig.username && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => saveMipsConnection.mutate()}
                    disabled={saveMipsConnection.isPending}
                  >
                    {saveMipsConnection.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                    Save Connection
                  </Button>
                )}
              </div>

              {testResult && (
                <div className={`flex items-center gap-2 text-xs p-2 rounded-lg ${testResult.success ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {testResult.success ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {testResult.message}
                </div>
              )}
            </CardContent>
          </Card>

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
