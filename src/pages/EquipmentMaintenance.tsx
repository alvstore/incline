import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Wrench, AlertTriangle, CheckCircle, XCircle, Pencil, Copy, Calendar, ShieldCheck, QrCode, ListTodo, Search, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchEquipment, fetchMaintenanceRecords, createMaintenanceRecord, updateEquipmentStatus, getEquipmentStats, getMaintenanceCostsByMonth, deleteEquipment, bulkDeleteEquipment } from '@/services/equipmentService';
import QRCode from 'qrcode';
import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { AddEquipmentDrawer } from '@/components/equipment/AddEquipmentDrawer';
import { useBranchContext } from '@/contexts/BranchContext';
import { muscleGroupLabel, primaryCategoryLabel } from '@/lib/equipment/taxonomy';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function EquipmentMaintenancePage() {
  const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [equipmentToEdit, setEquipmentToEdit] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const queryClient = useQueryClient();
  const { effectiveBranchId = '' } = useBranchContext();
  const currentBranchId = effectiveBranchId || undefined;
  const { roles } = useAuth();
  const roleNames = (roles || []).map((r) => r.role);
  const canViewPrice = can.viewFinancials(roleNames);
  const canDelete = roleNames.includes('owner') || roleNames.includes('admin');

  const { data: equipment = [], isLoading } = useQuery({
    queryKey: ['equipment-list', currentBranchId],
    queryFn: () => fetchEquipment(currentBranchId),
  });

  const { data: maintenanceRecords = [] } = useQuery({
    queryKey: ['maintenance-records', currentBranchId],
    queryFn: () => fetchMaintenanceRecords(undefined, currentBranchId),
  });

  const { data: stats } = useQuery({
    queryKey: ['equipment-stats', currentBranchId],
    queryFn: () => getEquipmentStats(currentBranchId),
  });

  const { data: monthlyCosts } = useQuery({
    queryKey: ['maintenance-costs', currentBranchId],
    queryFn: () => getMaintenanceCostsByMonth(currentBranchId),
  });

  const createMaintenanceMutation = useMutation({
    mutationFn: createMaintenanceRecord,
    onSuccess: () => {
      toast.success('Maintenance record created');
      queryClient.invalidateQueries({ queryKey: ['maintenance-records'] });
      setMaintenanceDialogOpen(false);
    },
    onError: (error) => {
      toast.error('Failed to create record: ' + error.message);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: any }) => updateEquipmentStatus(id, status),
    onSuccess: () => {
      toast.success('Status updated');
      queryClient.invalidateQueries({ queryKey: ['equipment-list'] });
      queryClient.invalidateQueries({ queryKey: ['equipment-stats'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEquipment(id),
    onSuccess: () => {
      toast.success('Equipment deleted');
      queryClient.invalidateQueries({ queryKey: ['equipment-list'] });
      queryClient.invalidateQueries({ queryKey: ['equipment-stats'] });
      setConfirmDelete(null);
    },
    onError: (error: any) => {
      if (error?.code === 'HAS_MAINTENANCE_HISTORY') {
        toast.error(`Cannot delete — ${error.maintenanceCount} maintenance record(s) exist. Use "Retire" to keep the audit trail.`);
        setConfirmDelete(null);
      } else {
        toast.error('Delete failed: ' + (error?.message || 'Unknown'));
      }
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteEquipment(ids),
    onSuccess: (res) => {
      if (res.failed.length > 0) {
        toast.warning(`Deleted ${res.ok}, skipped ${res.failed.length} (have maintenance history — retire instead)`);
      } else {
        toast.success(`Deleted ${res.ok} equipment`);
      }
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      queryClient.invalidateQueries({ queryKey: ['equipment-list'] });
      queryClient.invalidateQueries({ queryKey: ['equipment-stats'] });
    },
  });

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      operational: 'bg-success/10 text-success',
      maintenance: 'bg-warning/10 text-warning',
      out_of_order: 'bg-destructive/10 text-destructive',
      retired: 'bg-muted text-muted-foreground',
    };
    return colors[status] || 'bg-muted text-muted-foreground';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'operational': return <CheckCircle className="h-4 w-4 text-success" />;
      case 'maintenance': return <Wrench className="h-4 w-4 text-warning" />;
      case 'out_of_order': return <XCircle className="h-4 w-4 text-destructive" />;
      default: return null;
    }
  };

  const totalMonthlyCost = monthlyCosts ? Object.values(monthlyCosts).reduce((a, b) => a + b, 0) : 0;

  // Auto-number duplicates so list reads "Treadmill #1, #2" instead of "Treadmill, Treadmill"
  const numberedEquipment = useMemo(() => {
    const counts: Record<string, number> = {};
    const totals: Record<string, number> = {};
    (equipment as any[]).forEach((e) => {
      totals[e.name] = (totals[e.name] || 0) + 1;
    });
    return (equipment as any[]).map((e) => {
      counts[e.name] = (counts[e.name] || 0) + 1;
      const displayName = totals[e.name] > 1 ? `${e.name} #${counts[e.name]}` : e.name;
      return { ...e, _displayName: displayName, _unitCount: totals[e.name] };
    });
  }, [equipment]);

  // Search filter (name, brand, model, serial, category, location)
  const filteredEquipment = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return numberedEquipment;
    return numberedEquipment.filter((e) => {
      const haystack = [e.name, e.brand, e.model, e.serial_number, e.category, e.location]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  })();

  const allSelected = filteredEquipment.length > 0 && filteredEquipment.every((e) => selectedIds.has(e.id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredEquipment.map((e) => e.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  // Derived: due / overdue / warranty signals
  const today = new Date();
  const in7Days = new Date(today.getTime() + 7 * 86400000);
  const in30Days = new Date(today.getTime() + 30 * 86400000);
  const dueThisWeek = (maintenanceRecords as any[]).filter(
    (r) => r.scheduled_date && !r.completed_date && new Date(r.scheduled_date) <= in7Days && new Date(r.scheduled_date) >= today,
  ).length;
  const overdue = (maintenanceRecords as any[]).filter(
    (r) => r.scheduled_date && !r.completed_date && new Date(r.scheduled_date) < today,
  ).length;
  const warrantyExpiring = (equipment as any[]).filter(
    (e) => e.warranty_expiry && new Date(e.warranty_expiry) > today && new Date(e.warranty_expiry) <= in30Days,
  ).length;

  const { data: branchInfo } = useQuery({
    queryKey: ['branch-info', currentBranchId],
    enabled: !!currentBranchId,
    queryFn: async () => {
      const { data } = await (await import('@/integrations/supabase/client')).supabase
        .from('branches').select('id, name').eq('id', currentBranchId!).maybeSingle();
      return data;
    },
  });

  const showQR = async (item: any) => {
    try {
      const { escapeHtml: e } = await import('@/utils/htmlEscape');
      const payload = `${window.location.origin}/equipment/${item.id}`;
      const url = await QRCode.toDataURL(payload, { width: 320, margin: 1 });
      const w = window.open('', '_blank', 'width=380,height=480');
      if (w) {
        w.document.write(`<html><head><title>${e(item.name)} QR</title></head>
          <body style="font-family:Inter,sans-serif;padding:24px;text-align:center;">
            <h2 style="margin:0 0 8px;">${e(item.name)}</h2>
            <p style="color:#64748b;margin:0 0 16px;">${e(item.model || item.serial_number || '')}</p>
            <img src="${url}" style="width:280px;height:280px;" />
            <p style="font-size:11px;color:#64748b;word-break:break-all;margin-top:12px;">${e(payload)}</p>
            <button onclick="window.print()" style="margin-top:12px;padding:8px 16px;background:#4f46e5;color:#fff;border:0;border-radius:8px;cursor:pointer;">Print</button>
          </body></html>`);
      }
    } catch (e) {
      toast.error('Failed to generate QR');
    }
  };

  const createMaintenanceTask = (item: any) => {
    setSelectedEquipment(item.id);
    setMaintenanceDialogOpen(true);
  };

  const copyModelNumber = async (item: any) => {
    const modelValue = item.model || item.serial_number;
    if (!modelValue) {
      toast.error('No model number to copy');
      return;
    }

    try {
      await navigator.clipboard.writeText(modelValue);
      toast.success('Model number copied');
    } catch {
      toast.error('Failed to copy model number');
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Equipment</h1>
            {branchInfo?.name && (
              <Badge variant="outline" className="rounded-full">
                Branch: {branchInfo.name}
              </Badge>
            )}
          </div>
          <Button onClick={() => setAddDrawerOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Equipment
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Equipment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Operational</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">{stats?.operational || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">In Maintenance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning">{stats?.maintenance || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Out of Order</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{stats?.outOfOrder || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Due This Week</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning flex items-center gap-2">
                <Calendar className="h-5 w-5" /> {dueThisWeek}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" /> {overdue}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Warranty Expiring (30d)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-info flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" /> {warrantyExpiring}
              </div>
            </CardContent>
          </Card>
        </div>

        {canViewPrice && (
          <div className="text-xs text-muted-foreground">
            YTD maintenance cost: <span className="font-semibold text-primary">₹{totalMonthlyCost.toLocaleString()}</span>
          </div>
        )}

        <Tabs defaultValue="equipment">
          <TabsList>
            <TabsTrigger value="equipment">Equipment</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance Log</TabsTrigger>
          </TabsList>

          <TabsContent value="equipment" className="mt-4">
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle>All Equipment</CardTitle>
                  {selectedIds.size > 0 && (
                    <Badge variant="secondary" className="rounded-full">{selectedIds.size} selected</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {selectedIds.size > 0 && canDelete && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmBulkDelete(true)}
                      className="gap-1.5"
                    >
                      <Trash2 className="h-4 w-4" /> Delete ({selectedIds.size})
                    </Button>
                  )}
                  <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by name, brand, model, serial, category, or location…"
                      className="pl-9"
                      aria-label="Search equipment"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {canDelete && (
                          <TableHead className="w-10">
                            <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                          </TableHead>
                        )}
                        <TableHead>Name</TableHead>
                        <TableHead>Model Number</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Location</TableHead>
                        {canViewPrice && <TableHead>Purchase Price</TableHead>}
                        <TableHead>Warranty</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEquipment.map((item: any) => (
                        <TableRow key={item.id} data-state={selectedIds.has(item.id) ? 'selected' : undefined}>
                          {canDelete && (
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(item.id)}
                                onCheckedChange={() => toggleOne(item.id)}
                                aria-label={`Select ${item._displayName}`}
                              />
                            </TableCell>
                          )}
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center">
                                {getStatusIcon(item.status)}
                              </div>
                              <div>
                                <div className="font-medium">{item._displayName}</div>
                                <div className="text-sm text-muted-foreground">
                                  {item.brand || (item._unitCount > 1 ? `${item._unitCount} units` : '-')}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span>{item.model || item.serial_number || '-'}</span>
                              {(item.model || item.serial_number) && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => copyModelNumber(item)}
                                  aria-label="Copy model number"
                                  title="Copy model number"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="text-sm">{primaryCategoryLabel(item.primary_category) !== '—' ? primaryCategoryLabel(item.primary_category) : (item.category || '-')}</span>
                              {Array.isArray(item.muscle_groups) && item.muscle_groups.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {item.muscle_groups.slice(0, 3).map((mg: string) => (
                                    <Badge key={mg} variant="outline" className="text-[10px] px-1.5 py-0">
                                      {muscleGroupLabel(mg)}
                                    </Badge>
                                  ))}
                                  {item.muscle_groups.length > 3 && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">+{item.muscle_groups.length - 3}</Badge>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{item.location || '-'}</TableCell>
                          {canViewPrice && (
                            <TableCell>₹{(item.purchase_price || 0).toLocaleString()}</TableCell>
                          )}
                          <TableCell>
                            {item.warranty_expiry ? (
                              new Date(item.warranty_expiry) > new Date() ? (
                                <span className="text-success">{new Date(item.warranty_expiry).toLocaleDateString()}</span>
                              ) : (
                                <span className="text-muted-foreground">Expired</span>
                              )
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(item.status)}>{item.status.replace('_', ' ')}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Select
                                value={item.status}
                                onValueChange={(value) => updateStatusMutation.mutate({ id: item.id, status: value })}
                              >
                                <SelectTrigger className="w-28 h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="operational">Operational</SelectItem>
                                  <SelectItem value="maintenance">Maintenance</SelectItem>
                                  <SelectItem value="out_of_order">Out of Order</SelectItem>
                                  <SelectItem value="retired">Retired</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEquipmentToEdit(item);
                                  setAddDrawerOpen(true);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => showQR(item)}
                                title="Show QR code"
                                aria-label="Show QR code"
                              >
                                <QrCode className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => createMaintenanceTask(item)}
                                title="Create maintenance task"
                                aria-label="Create maintenance task"
                              >
                                <ListTodo className="h-3 w-3" />
                              </Button>
                              <Sheet open={maintenanceDialogOpen && selectedEquipment === item.id} onOpenChange={(open) => {
                                setMaintenanceDialogOpen(open);
                                if (open) setSelectedEquipment(item.id);
                              }}>
                                <SheetTrigger asChild>
                                  <Button size="sm" variant="outline">
                                    <Wrench className="h-3 w-3" />
                                  </Button>
                                </SheetTrigger>
                                <SheetContent>
                                  <SheetHeader>
                                    <SheetTitle>Log Maintenance - {item.name}</SheetTitle>
                                  </SheetHeader>
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      const form = e.target as HTMLFormElement;
                                      const formData = new FormData(form);
                                      createMaintenanceMutation.mutate({
                                        equipmentId: item.id,
                                        maintenanceType: formData.get('maintenanceType') as string,
                                        description: formData.get('description') as string,
                                        scheduledDate: formData.get('scheduledDate') as string,
                                        cost: Number(formData.get('cost')) || undefined,
                                      });
                                    }}
                                    className="space-y-4 mt-6"
                                  >
                                    <div className="space-y-2">
                                      <Label htmlFor="maintenanceType">Maintenance Type</Label>
                                      <Select name="maintenanceType" defaultValue="preventive">
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="preventive">Preventive</SelectItem>
                                          <SelectItem value="corrective">Corrective</SelectItem>
                                          <SelectItem value="inspection">Inspection</SelectItem>
                                          <SelectItem value="repair">Repair</SelectItem>
                                          <SelectItem value="replacement">Replacement</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="description">Description</Label>
                                      <Textarea name="description" placeholder="Describe the maintenance work..." />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-2">
                                        <Label htmlFor="scheduledDate">Scheduled Date</Label>
                                        <Input type="date" name="scheduledDate" />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor="cost">Estimated Cost</Label>
                                        <Input type="number" name="cost" placeholder="0" />
                                      </div>
                                    </div>
                                    <Button type="submit" className="w-full" disabled={createMaintenanceMutation.isPending}>
                                      {createMaintenanceMutation.isPending ? 'Saving...' : 'Log Maintenance'}
                                    </Button>
                                  </form>
                                </SheetContent>
                              </Sheet>
                              {canDelete && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => setConfirmDelete({ id: item.id, name: item._displayName })}
                                  title="Delete equipment"
                                  aria-label="Delete equipment"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredEquipment.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={canViewPrice ? (canDelete ? 9 : 8) : (canDelete ? 8 : 7)} className="text-center py-8 text-muted-foreground">
                            {searchQuery.trim()
                              ? `No equipment matches "${searchQuery}"`
                              : 'No equipment found'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="maintenance" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Maintenance History</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Equipment</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Scheduled</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead>Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {maintenanceRecords.map((record: any) => (
                      <TableRow key={record.id}>
                        <TableCell>
                          <div className="font-medium">{record.equipment?.name}</div>
                          <div className="text-sm text-muted-foreground">{record.equipment?.brand}</div>
                        </TableCell>
                        <TableCell className="capitalize">{record.maintenance_type}</TableCell>
                        <TableCell className="max-w-xs truncate">{record.description || '-'}</TableCell>
                        <TableCell>{record.scheduled_date ? new Date(record.scheduled_date).toLocaleDateString() : '-'}</TableCell>
                        <TableCell>
                          {record.completed_date ? (
                            <Badge className="bg-success/10 text-success">
                              {new Date(record.completed_date).toLocaleDateString()}
                            </Badge>
                          ) : (
                            <Badge className="bg-warning/10 text-warning">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell>₹{(record.cost || 0).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                    {maintenanceRecords.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No maintenance records
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        <AddEquipmentDrawer
          open={addDrawerOpen}
          onOpenChange={(open) => {
            setAddDrawerOpen(open);
            if (!open) {
              setEquipmentToEdit(null);
            }
          }}
          branchId={effectiveBranchId}
          equipmentToEdit={equipmentToEdit}
        />

        <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the equipment record. If maintenance history exists,
                deletion will be blocked — use the status selector to set it to <strong>Retired</strong> instead,
                which preserves the audit trail.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selectedIds.size} equipment item(s)?</AlertDialogTitle>
              <AlertDialogDescription>
                Items with maintenance history will be skipped (retire them instead).
                The rest will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
                disabled={bulkDeleteMutation.isPending}
              >
                {bulkDeleteMutation.isPending ? 'Deleting…' : `Delete ${selectedIds.size}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
