import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Server, Save, CheckCircle, XCircle, Loader2, Eye, EyeOff } from "lucide-react";

interface MIPSConnectionCardProps {
  branchId?: string;
  branchName?: string;
}

const MIPSConnectionCard = ({ branchId, branchName }: MIPSConnectionCardProps) => {
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [config, setConfig] = useState({
    server_url: "",
    username: "",
    password: "",
  });
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: connection, isLoading } = useQuery({
    queryKey: ["mips-connection-config", branchId],
    queryFn: async () => {
      if (!branchId) return null;
      const { data } = await supabase
        .from("mips_connections_safe" as any)
        .select("*")
        .eq("branch_id", branchId)
        .maybeSingle();
      if (data) {
        setConfig({
          server_url: (data as any).server_url || "",
          username: (data as any).username || "",
          password: "",
        });
      }
      return data;
    },
    enabled: !!branchId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!branchId || !config.server_url) throw new Error("Branch and server URL required");
      const payload: Record<string, unknown> = {
        branch_id: branchId,
        server_url: config.server_url.replace(/\/+$/, ""),
        username: config.username,
        is_active: true,
      };
      // Only include password if user entered a new one
      if (config.password) {
        payload.password = config.password;
      }
      const connData = connection as any;
      if (connData) {
        const { error } = await supabase
          .from("mips_connections")
          .update(payload)
          .eq("id", connData.id);
        if (error) throw error;
      } else {
        if (!config.password) throw new Error("Password is required for new connections");
        payload.password = config.password;
        const { error } = await supabase
          .from("mips_connections")
          .insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mips-connection-config"] });
      queryClient.invalidateQueries({ queryKey: ["mips-connection-test"] });
      toast.success("MIPS server connection saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleTest = async () => {
    if (!config.server_url) { toast.error("Enter a server URL"); return; }
    setIsTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("mips-proxy", {
        body: { endpoint: "/through/device/list", method: "GET", branch_id: branchId },
      });
      if (error) {
        setTestResult({ success: false, message: error.message });
      } else {
        const d = data as any;
        const ok = d?.success && (d?.data?.code === 200 || d?.data?.code === 0);
        setTestResult({
          success: ok,
          message: ok ? `Connected! ${d?.data?.total || 0} device(s)` : (d?.data?.msg || d?.error || "Failed"),
        });
      }
    } catch (e: any) {
      setTestResult({ success: false, message: e.message });
    } finally {
      setIsTesting(false);
    }
  };

  if (!branchId) {
    return (
      <Card className="rounded-2xl border-dashed">
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          Select a specific branch to configure MIPS server connection.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl shadow-lg shadow-muted/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <div className="p-2 rounded-full bg-primary/10">
            <Server className="h-4 w-4 text-primary" />
          </div>
          MIPS Server Connection
          {branchName && (
            <Badge variant="outline" className="ml-auto text-[10px]">{branchName}</Badge>
          )}
          {connection && (
            <Badge variant="secondary" className="text-[10px] bg-success/10 text-success">Configured</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Server URL (with port)</Label>
          <Input
            placeholder="http://212.38.94.228:9000"
            value={config.server_url}
            onChange={(e) => setConfig({ ...config, server_url: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Username</Label>
            <Input
              placeholder="admin"
              value={config.username}
              onChange={(e) => setConfig({ ...config, username: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Password</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder={connection ? "Leave blank to keep current" : "Enter password"}
                value={config.password}
                onChange={(e) => setConfig({ ...config, password: e.target.value })}
              />
              <Button
                type="button" variant="ghost" size="icon"
                className="absolute right-0 top-0 h-full w-9"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={isTesting || !config.server_url}>
            {isTesting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Server className="h-3.5 w-3.5 mr-1.5" />}
            Test
          </Button>
          <Button type="button" size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !config.server_url}>
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save Connection
          </Button>
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 text-xs p-2.5 rounded-lg ${
            testResult.success ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          }`}>
            {testResult.success ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {testResult.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MIPSConnectionCard;
