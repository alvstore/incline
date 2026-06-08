import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranchContext } from "@/contexts/BranchContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Building2, Plus, Pencil, Trash2, Sparkles, Info, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { useBenefitTypes } from "@/hooks/useBenefitTypes";
import * as LucideIcons from "lucide-react";

const GENDER_OPTIONS = [
  { value: "unisex", label: "Unisex (All)" },
  { value: "male", label: "Male Only" },
  { value: "female", label: "Female Only" },
];

const ALL_DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
];

type FilterKey = "all" | "unisex" | "male" | "female" | "maintenance" | "inactive";

interface FacilityFormData {
  name: string; benefit_type_id: string; gender_access: string;
  capacity: number; description: string; is_active: boolean;
  available_days: string[]; under_maintenance: boolean;
}

const defaultFormData: FacilityFormData = {
  name: "", benefit_type_id: "", gender_access: "unisex", capacity: 1,
  description: "", is_active: true,
  available_days: ['mon','tue','wed','thu','fri','sat','sun'], under_maintenance: false,
};

function getIconComponent(iconName: string | null) {
  if (!iconName) return <Sparkles className="h-5 w-5" />;
  const Icon = (LucideIcons as any)[iconName];
  return Icon ? <Icon className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />;
}

function genderBadgeClass(g: string) {
  if (g === "male") return "bg-info/10 text-info border-info/25";
  if (g === "female") return "bg-destructive/10 text-destructive border-destructive/25";
  return "bg-muted text-foreground border-border";
}

export function FacilitiesManager() {
  const queryClient = useQueryClient();
  const { effectiveBranchId } = useBranchContext();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FacilityFormData>(defaultFormData);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const branchId = effectiveBranchId || "";
  const { data: benefitTypes } = useBenefitTypes(branchId);

  const { data: facilities, isLoading } = useQuery({
    queryKey: ["facilities", branchId],
    queryFn: async () => {
      if (!branchId) return [];
      const { data, error } = await supabase
        .from("facilities")
        .select("*, benefit_type:benefit_types(id, name, icon)")
        .eq("branch_id", branchId)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!branchId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (data: FacilityFormData & { id?: string }) => {
      const payload = {
        branch_id: branchId,
        name: data.name,
        benefit_type_id: data.benefit_type_id,
        gender_access: data.gender_access,
        capacity: data.capacity,
        description: data.description || null,
        is_active: data.is_active,
        available_days: data.available_days,
        under_maintenance: data.under_maintenance,
      };
      if (data.id) {
        const { error } = await supabase.from("facilities").update(payload).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("facilities").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["facilities"] });
      queryClient.invalidateQueries({ queryKey: ["benefit-types-with-deps"] });
      toast.success(editingId ? "Facility updated" : "Facility created");
      resetForm();
    },
    onError: (error: any) => toast.error(error.message || "Failed to save"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("facilities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["facilities"] });
      queryClient.invalidateQueries({ queryKey: ["benefit-types-with-deps"] });
      toast.success("Facility deleted");
    },
    onError: (error: any) => toast.error(error.message || "Failed to delete"),
  });

  const resetForm = () => {
    setFormData(defaultFormData);
    setEditingId(null);
    setIsDrawerOpen(false);
  };

  const handleEdit = (facility: any) => {
    setFormData({
      name: facility.name,
      benefit_type_id: facility.benefit_type_id,
      gender_access: facility.gender_access || "unisex",
      capacity: facility.capacity || 1,
      description: facility.description || "",
      is_active: facility.is_active ?? true,
      available_days: facility.available_days || ['mon','tue','wed','thu','fri','sat','sun'],
      under_maintenance: facility.under_maintenance ?? false,
    });
    setEditingId(facility.id);
    setIsDrawerOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.benefit_type_id) {
      toast.error("Please fill in required fields");
      return;
    }
    upsertMutation.mutate({ ...formData, id: editingId || undefined });
  };

  const filtered = useMemo(() => {
    if (!facilities) return [];
    return (facilities as any[]).filter((f) => {
      if (searchTerm && !f.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (filter === "all") return true;
      if (filter === "maintenance") return f.under_maintenance;
      if (filter === "inactive") return !f.is_active;
      return f.gender_access === filter;
    });
  }, [facilities, filter, searchTerm]);

  // Group by benefit_type
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; icon: string | null; rows: any[]; totalCap: number }>();
    for (const f of filtered) {
      const key = f.benefit_type?.id || "_unassigned";
      const name = f.benefit_type?.name || "Unassigned";
      const icon = f.benefit_type?.icon || null;
      if (!map.has(key)) map.set(key, { name, icon, rows: [], totalCap: 0 });
      const g = map.get(key)!;
      g.rows.push(f);
      g.totalCap += f.capacity || 0;
    }
    return Array.from(map.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [filtered]);

  const counts = useMemo(() => {
    const list = (facilities as any[]) || [];
    return {
      all: list.length,
      unisex: list.filter(f => f.gender_access === "unisex").length,
      male: list.filter(f => f.gender_access === "male").length,
      female: list.filter(f => f.gender_access === "female").length,
      maintenance: list.filter(f => f.under_maintenance).length,
      inactive: list.filter(f => !f.is_active).length,
    };
  }, [facilities]);

  if (!branchId) return null;

  const FilterChip = ({ k, label }: { k: FilterKey; label: string }) => (
    <Button
      type="button"
      size="sm"
      variant={filter === k ? "default" : "outline"}
      className="rounded-full h-8"
      onClick={() => setFilter(k)}
    >
      {label} <Badge variant="secondary" className="ml-2 px-1.5 h-5">{counts[k]}</Badge>
    </Button>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl"><Building2 className="h-6 w-6 text-primary" /></div>
          <div>
            <h2 className="text-xl font-semibold">Facilities &amp; Rooms</h2>
            <p className="text-sm text-muted-foreground">Physical rooms with capacity, schedule, and gender-based access.</p>
          </div>
        </div>
        <Button onClick={() => setIsDrawerOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Facility</Button>
      </div>

      <Alert className="bg-primary/10 border-primary/25">
        <Info className="h-4 w-4 text-primary" />
        <AlertDescription className="text-sm text-foreground">
          Have separate male and female rooms for the same benefit? Add <strong>two facilities under the same Benefit Type</strong>
          {" "}(e.g. one Ice Bath benefit, two rooms with different gender access). Don't duplicate the benefit type itself.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip k="all" label="All" />
        <FilterChip k="unisex" label="Unisex" />
        <FilterChip k="male" label="Male" />
        <FilterChip k="female" label="Female" />
        <FilterChip k="maintenance" label="Maintenance" />
        <FilterChip k="inactive" label="Inactive" />
        <div className="flex-1" />
        <Input placeholder="Search rooms..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="max-w-xs" />
      </div>

      <Sheet open={isDrawerOpen} onOpenChange={(open) => { setIsDrawerOpen(open); if (!open) resetForm(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingId ? "Edit Facility" : "Add Facility"}</SheetTitle>
            <SheetDescription>A physical room or station. Gender access here decides who can book this specific room.</SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Facility Name *</Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Room A, Men's Wing, Pod 1" />
              <p className="text-xs text-muted-foreground">Tip: name the room itself, not the gender — gender has its own field below.</p>
            </div>

            <div className="space-y-2">
              <Label>Benefit Category *</Label>
              <Select value={formData.benefit_type_id} onValueChange={(v) => setFormData({ ...formData, benefit_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select benefit type" /></SelectTrigger>
                <SelectContent>
                  {benefitTypes?.map((bt) => (
                    <SelectItem key={bt.id} value={bt.id}>
                      <span className="flex items-center gap-2">{getIconComponent(bt.icon)}{bt.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Gender Access *</Label>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Members can only book rooms matching their gender. Add multiple rooms under the same benefit type to serve different genders.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select value={formData.gender_access} onValueChange={(v) => setFormData({ ...formData, gender_access: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Capacity</Label>
              <Input type="number" value={formData.capacity}
                onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 1 })}
                min={1} max={100} />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Optional notes..." rows={2} />
            </div>

            <div className="space-y-2">
              <Label>Weekly Schedule</Label>
              <p className="text-xs text-muted-foreground">Select days this facility is open</p>
              <div className="flex flex-wrap gap-2">
                {ALL_DAYS.map((day) => {
                  const isSelected = formData.available_days.includes(day.key);
                  return (
                    <Button key={day.key} type="button" size="sm"
                      variant={isSelected ? "default" : "outline"} className="w-12"
                      onClick={() => {
                        const newDays = isSelected
                          ? formData.available_days.filter(d => d !== day.key)
                          : [...formData.available_days, day.key];
                        setFormData({ ...formData, available_days: newDays });
                      }}>
                      {day.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Under Maintenance</Label>
                <p className="text-xs text-muted-foreground">Temporarily disable all bookings</p>
              </div>
              <Switch checked={formData.under_maintenance} onCheckedChange={(c) => setFormData({ ...formData, under_maintenance: c })} />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">Show in booking options</p>
              </div>
              <Switch checked={formData.is_active} onCheckedChange={(c) => setFormData({ ...formData, is_active: c })} />
            </div>

            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              <Button type="submit" disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? "Saving..." : editingId ? "Update" : "Create"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {isLoading ? (
        <div className="text-center py-8">Loading facilities...</div>
      ) : groups.length > 0 ? (
        <div className="space-y-5">
          {groups.map(([key, g]) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <div className="p-1.5 bg-primary/10 rounded-lg text-primary">{getIconComponent(g.icon)}</div>
                <h3 className="font-semibold text-foreground">{g.name}</h3>
                <Badge variant="outline" className="text-xs">{g.rows.length} room{g.rows.length !== 1 ? "s" : ""}</Badge>
                <Badge variant="outline" className="text-xs">total cap {g.totalCap}</Badge>
              </div>
              <div className="grid gap-2">
                {g.rows.map((f: any) => (
                  <Card key={f.id} className="rounded-xl shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground">{f.name}</span>
                            <Badge variant="outline" className={`text-xs capitalize ${genderBadgeClass(f.gender_access)}`}>{f.gender_access}</Badge>
                            <Badge variant="outline" className="text-xs">cap {f.capacity}</Badge>
                            {f.under_maintenance && <Badge variant="destructive" className="text-xs">🔧 Maintenance</Badge>}
                            {!f.is_active && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                          </div>
                          {f.description && <p className="text-sm text-muted-foreground mt-0.5">{f.description}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(f)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this facility?")) deleteMutation.mutate(f.id); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground mb-4">No facilities match this filter.</p>
            <Button onClick={() => setIsDrawerOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Facility</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
