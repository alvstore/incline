import { useState } from "react";
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
import { Sparkles, Plus, Pencil, Trash2, Info, Building2, Users, Package } from "lucide-react";
import { toast } from "sonner";
import * as LucideIcons from "lucide-react";

export interface BenefitTypeRecord {
  id: string;
  branch_id: string;
  name: string;
  code: string;
  description: string | null;
  icon: string | null;
  is_bookable: boolean | null;
  is_active: boolean | null;
  display_order: number | null;
  category: string | null;
  default_duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

interface FacilityLite { id: string; name: string; gender_access: string; capacity: number; is_active: boolean; under_maintenance: boolean; }
interface DependencyCounts { facilities: FacilityLite[]; plan_count: number; member_credit_count: number; }

const ICON_OPTIONS = ["Sparkles","Thermometer","Snowflake","Droplets","Flame","Wind","Dumbbell","Heart","Star","Zap","Sun","Moon","Coffee","Bath"];
const CATEGORY_OPTIONS = [
  { value: "wellness", label: "Wellness" },
  { value: "fitness", label: "Fitness" },
  { value: "amenity", label: "Amenity" },
  { value: "service", label: "Service" },
];

interface BenefitTypeFormData {
  name: string; code: string; description: string; icon: string;
  is_bookable: boolean; is_active: boolean; category: string; default_duration_minutes: number;
}
const defaultFormData: BenefitTypeFormData = {
  name: "", code: "", description: "", icon: "Sparkles",
  is_bookable: true, is_active: true, category: "wellness", default_duration_minutes: 30,
};

function getIconComponent(iconName: string) {
  const Icon = (LucideIcons as any)[iconName];
  return Icon ? <Icon className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />;
}

function genderBadgeClass(g: string) {
  if (g === "male") return "bg-info/10 text-info border-info/25";
  if (g === "female") return "bg-destructive/10 text-destructive border-destructive/25";
  return "bg-muted text-foreground border-border";
}

export function BenefitTypesManager() {
  const queryClient = useQueryClient();
  const { effectiveBranchId } = useBranchContext();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<BenefitTypeFormData>(defaultFormData);
  const [showInactive, setShowInactive] = useState(false);

  const branchId = effectiveBranchId || "";

  const { data: benefitTypes, isLoading } = useQuery({
    queryKey: ["benefit-types-with-deps", branchId, showInactive],
    queryFn: async () => {
      if (!branchId) return [];
      const query = supabase
        .from("benefit_types")
        .select(`
          *,
          facilities(id, name, gender_access, capacity, is_active, under_maintenance),
          plan_benefits(count),
          member_benefit_credits(count)
        `)
        .eq("branch_id", branchId)
        .order("display_order", { ascending: true });
      if (!showInactive) query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((bt: any) => ({
        ...bt,
        _deps: {
          facilities: (bt.facilities || []) as FacilityLite[],
          plan_count: bt.plan_benefits?.[0]?.count ?? 0,
          member_credit_count: bt.member_benefit_credits?.[0]?.count ?? 0,
        } as DependencyCounts,
      }));
    },
    enabled: !!branchId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (data: BenefitTypeFormData & { id?: string }) => {
      const payload = {
        branch_id: branchId,
        name: data.name,
        code: data.code.toLowerCase().replace(/\s+/g, "_"),
        description: data.description || null,
        icon: data.icon,
        is_bookable: data.is_bookable,
        is_active: data.is_active,
        category: data.category,
        default_duration_minutes: data.default_duration_minutes,
      };
      if (data.id) {
        const { error } = await supabase.from("benefit_types").update(payload).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("benefit_types").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benefit-types-with-deps"] });
      queryClient.invalidateQueries({ queryKey: ["benefit-types"] });
      toast.success(editingId ? "Benefit type updated" : "Benefit type created");
      resetForm();
    },
    onError: (error: any) => {
      const msg = error?.message?.includes("uq_benefit_types_branch_name_ci")
        ? "A benefit type with this name already exists in this branch."
        : error?.message || "Failed to save benefit type";
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("benefit_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benefit-types-with-deps"] });
      queryClient.invalidateQueries({ queryKey: ["benefit-types"] });
      toast.success("Benefit type deleted");
    },
    onError: (error: any) => toast.error(error.message || "Failed to delete"),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("benefit_types").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benefit-types-with-deps"] });
      queryClient.invalidateQueries({ queryKey: ["benefit-types"] });
      toast.success("Benefit type deactivated");
    },
  });

  const resetForm = () => {
    setFormData(defaultFormData);
    setEditingId(null);
    setIsDrawerOpen(false);
  };

  const handleEdit = (bt: BenefitTypeRecord) => {
    setFormData({
      name: bt.name, code: bt.code,
      description: bt.description || "", icon: bt.icon || "Sparkles",
      is_bookable: bt.is_bookable ?? true, is_active: bt.is_active ?? true,
      category: bt.category || "wellness",
      default_duration_minutes: bt.default_duration_minutes || 30,
    });
    setEditingId(bt.id);
    setIsDrawerOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.code) { toast.error("Please fill in required fields"); return; }
    if (/\b(male|female|men|women|m|f)\b/i.test(formData.name)) {
      toast.warning("Tip: don't put gender in the benefit name. Add separate Facilities (rooms) for each gender instead.");
    }
    upsertMutation.mutate({ ...formData, id: editingId || undefined });
  };

  const handleDelete = (bt: any) => {
    const deps = bt._deps as DependencyCounts;
    const totalRefs = deps.facilities.length + deps.plan_count + deps.member_credit_count;
    if (totalRefs > 0) {
      const ok = confirm(
        `"${bt.name}" is in use:\n` +
        `• ${deps.facilities.length} facility/rooms\n` +
        `• ${deps.plan_count} plan(s)\n` +
        `• ${deps.member_credit_count} active member credit(s)\n\n` +
        `It cannot be deleted. Deactivate it instead? (it will be hidden from new bookings but history is preserved)`
      );
      if (ok) deactivateMutation.mutate(bt.id);
      return;
    }
    if (confirm(`Delete "${bt.name}"? This cannot be undone.`)) deleteMutation.mutate(bt.id);
  };

  const generateCode = (name: string) => name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  if (!branchId) {
    return <div className="text-center py-8 text-muted-foreground">No branch found. Please create a branch first.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl"><Sparkles className="h-6 w-6 text-primary" /></div>
          <div>
            <h2 className="text-xl font-semibold">Benefit Types</h2>
            <p className="text-sm text-muted-foreground">Categories like Ice Bath, Sauna, Steam Room — these get attached to plans and facilities.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? "Hide" : "Show"} inactive
          </Button>
          <Button onClick={() => setIsDrawerOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Benefit Type
          </Button>
        </div>
      </div>

      <Alert className="bg-primary/10 border-primary/25">
        <Info className="h-4 w-4 text-primary" />
        <AlertDescription className="text-sm text-foreground">
          <strong className="text-foreground">One category per benefit, multiple rooms per category.</strong> Don't create
          "Ice Bath Male" and "Ice Bath Female" as separate types — create one <strong>Ice Bath</strong> benefit, then add
          two facilities (rooms) under <em>Facilities &amp; Rooms</em> with different gender access. Members buy one entitlement
          and the system routes them to the room their gender allows.
        </AlertDescription>
      </Alert>

      <Sheet open={isDrawerOpen} onOpenChange={(open) => { setIsDrawerOpen(open); if (!open) resetForm(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingId ? "Edit Benefit Type" : "Add Benefit Type"}</SheetTitle>
            <SheetDescription>Create custom benefit categories. Gender, capacity and rooms are configured under Facilities.</SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value, code: editingId ? formData.code : generateCode(e.target.value) })}
                  placeholder="Ice Bath"
                />
              </div>
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="ice_bath" disabled={!!editingId} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Describe this benefit..." rows={2} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Icon</Label>
                <Select value={formData.icon} onValueChange={(v) => setFormData({ ...formData, icon: v })}>
                  <SelectTrigger>
                    <SelectValue>
                      <span className="flex items-center gap-2">{getIconComponent(formData.icon)}{formData.icon}</span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ICON_OPTIONS.map((icon) => (
                      <SelectItem key={icon} value={icon}>
                        <span className="flex items-center gap-2">{getIconComponent(icon)}{icon}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Default Duration (minutes)</Label>
              <Input type="number" value={formData.default_duration_minutes}
                onChange={(e) => setFormData({ ...formData, default_duration_minutes: parseInt(e.target.value) || 30 })}
                min={5} max={180} />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Requires Slot Booking</Label>
                <p className="text-xs text-muted-foreground">Enable time-based booking for this benefit</p>
              </div>
              <Switch checked={formData.is_bookable} onCheckedChange={(c) => setFormData({ ...formData, is_bookable: c })} />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">Show in benefit selection</p>
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
        <div className="text-center py-8">Loading benefit types...</div>
      ) : benefitTypes && benefitTypes.length > 0 ? (
        <div className="grid gap-3">
          {benefitTypes.map((bt: any) => {
            const deps: DependencyCounts = bt._deps;
            return (
              <Card key={bt.id} className="rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="p-2.5 bg-primary/10 rounded-xl text-primary">{getIconComponent(bt.icon || "Sparkles")}</div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground">{bt.name}</span>
                          <Badge variant="outline" className="text-xs font-mono">{bt.code}</Badge>
                          {bt.is_bookable && <Badge variant="secondary" className="text-xs">Bookable</Badge>}
                          {!bt.is_active && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                        </div>
                        {bt.description && <p className="text-sm text-muted-foreground mt-1">{bt.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(bt)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(bt)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </div>

                  {/* Dependency strip */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t">
                    <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{deps.facilities.length} room{deps.facilities.length !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1.5"><Package className="h-3.5 w-3.5" />{deps.plan_count} plan{deps.plan_count !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{deps.member_credit_count} member credit{deps.member_credit_count !== 1 ? "s" : ""}</span>
                  </div>

                  {/* Inline facility list */}
                  {deps.facilities.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-2 pt-1">
                      {deps.facilities.map((f) => (
                        <div key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-muted rounded-lg text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-foreground truncate">{f.name}</span>
                            <Badge variant="outline" className={`text-[10px] capitalize ${genderBadgeClass(f.gender_access)}`}>{f.gender_access}</Badge>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">cap {f.capacity}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground mb-4">No benefit types yet. Add categories like Ice Bath, Sauna, Steam Room.</p>
            <Button onClick={() => setIsDrawerOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Your First Benefit Type</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
