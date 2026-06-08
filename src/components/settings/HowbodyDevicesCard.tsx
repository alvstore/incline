// Devices inventory card — listed inside the HOWBODY settings page.
// Read: any staff role. Write (add/edit/delete): owner & admin only.
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Cpu, MapPin, CircleDot, Loader2, Pencil, Lock, Search } from "lucide-react";
import { listHowbodyDevices, type HowbodyDevice } from "@/services/howbodyDeviceService";
import { useBranches } from "@/hooks/useBranches";
import { useAuth } from "@/contexts/AuthContext";
import { HowbodyDeviceDrawer } from "./HowbodyDeviceDrawer";
import { formatDistanceToNow } from "date-fns";

export function HowbodyDevicesCard() {
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(["owner", "admin"]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<HowbodyDevice | null>(null);
  const [search, setSearch] = useState("");

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ["howbody-devices"],
    queryFn: listHowbodyDevices,
  });
  const { data: branches = [] } = useBranches();
  const branchMap = useMemo(
    () => Object.fromEntries((branches as any[]).map((b) => [b.id, b.name])),
    [branches],
  );

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return devices;
    return devices.filter((d) =>
      d.equipment_no.toLowerCase().includes(t) ||
      (d.label || "").toLowerCase().includes(t) ||
      (d.location || "").toLowerCase().includes(t),
    );
  }, [devices, search]);

  function openAdd() {
    setEditing(null);
    setDrawerOpen(true);
  }
  function openEdit(d: HowbodyDevice) {
    if (!canManage) return;
    setEditing(d);
    setDrawerOpen(true);
  }

  return (
    <Card className="rounded-2xl p-6 shadow-lg shadow/50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary"><Cpu className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-bold">Body Scanner Devices</h2>
            <p className="text-sm text-muted-foreground">
              Registry of physical HOWBODY scanners. Webhooks auto-register unknown devices for review.
            </p>
          </div>
        </div>
        {canManage ? (
          <Button onClick={openAdd} className="bg-primary hover:bg-primary">
            <Plus className="mr-2 h-4 w-4" /> Add device
          </Button>
        ) : (
          <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
            <Lock className="mr-1 h-3 w-3" /> View only
          </Badge>
        )}
      </div>

      <div className="mt-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by serial, label, location…"
          className="pl-9"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Equipment No.</TableHead>
              <TableHead>Label / Location</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Scans</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={canManage ? 7 : 6} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={canManage ? 7 : 6} className="py-10 text-center text-sm text-muted-foreground">
                  {search ? "No devices match your search." : "No devices registered yet."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((d) => (
              <TableRow
                key={d.id}
                className={canManage ? "cursor-pointer hover:bg-muted" : ""}
                onClick={() => openEdit(d)}
              >
                <TableCell className="font-mono text-xs">
                  {d.equipment_no}
                  {d.auto_registered && (
                    <Badge variant="outline" className="ml-2 border-warning/25 bg-warning/10 text-[10px] text-warning">
                      Auto-registered
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{d.label || <span className="text-muted-foreground">—</span>}</div>
                  {d.location && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {d.location}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {d.branch_id
                    ? (branchMap[d.branch_id] || "—")
                    : <span className="text-warning">Unassigned</span>}
                </TableCell>
                <TableCell className="text-sm font-semibold">{d.total_scans}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {d.last_seen_at ? formatDistanceToNow(new Date(d.last_seen_at), { addSuffix: true }) : "Never"}
                </TableCell>
                <TableCell>
                  {d.is_active ? (
                    <Badge variant="outline" className="border-success/25 bg-success/10 text-success">
                      <CircleDot className="mr-1 h-3 w-3" /> Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                      Disabled
                    </Badge>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEdit(d); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canManage && (
        <HowbodyDeviceDrawer open={drawerOpen} onOpenChange={setDrawerOpen} device={editing} />
      )}
    </Card>
  );
}
