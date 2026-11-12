import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEquipment, updateEquipment, type Equipment } from '@/services/equipmentService';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { PRIMARY_CATEGORIES, MUSCLE_GROUPS, MOVEMENT_PATTERNS } from '@/lib/equipment/taxonomy';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';

interface AddEquipmentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  equipmentToEdit?: Equipment | null;
}

const getInitialFormData = (equipment?: Equipment | null) => ({
  name: equipment?.name || '',
  brand: equipment?.brand || '',
  model: equipment?.model || '',
  serialNumber: equipment?.serial_number || '',
  category: equipment?.category || '',
  primaryCategory: equipment?.primary_category || '',
  muscleGroups: (equipment?.muscle_groups ?? []) as string[],
  movementPattern: equipment?.movement_pattern || '',
  location: equipment?.location || '',
  purchaseDate: equipment?.purchase_date || '',
  purchasePrice: equipment?.purchase_price ? String(equipment.purchase_price) : '',
  warrantyExpiry: equipment?.warranty_expiry || '',
  notes: equipment?.notes || '',
});

export function AddEquipmentDrawer({ open, onOpenChange, branchId, equipmentToEdit }: AddEquipmentDrawerProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState(getInitialFormData(equipmentToEdit));
  const { roles } = useAuth();
  const canViewPrice = can.viewFinancials((roles || []).map((r) => r.role));

  const invalidateEquipmentQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['equipment', branchId] });
    queryClient.invalidateQueries({ queryKey: ['equipment'] });
    queryClient.invalidateQueries({ queryKey: ['equipment-list'] });
    queryClient.invalidateQueries({ queryKey: ['equipment-stats'] });
  };

  useEffect(() => {
    if (!open) return;
    setFormData(getInitialFormData(equipmentToEdit));
  }, [open, equipmentToEdit]);

  const createMutation = useMutation({
    mutationFn: () => createEquipment({
      branchId,
      name: formData.name,
      brand: formData.brand || undefined,
      model: formData.model || undefined,
      serialNumber: formData.serialNumber || undefined,
      category: formData.category || undefined,
      primaryCategory: formData.primaryCategory || undefined,
      muscleGroups: formData.muscleGroups,
      movementPattern: formData.movementPattern || undefined,
      location: formData.location || undefined,
      purchaseDate: formData.purchaseDate || undefined,
      purchasePrice: formData.purchasePrice ? parseFloat(formData.purchasePrice) : undefined,
      warrantyExpiry: formData.warrantyExpiry || undefined,
    }),
    onSuccess: () => {
      toast.success('Equipment added successfully');
      invalidateEquipmentQueries();
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      // Provide clear error messages for RLS/permission issues
      const message = error.message || 'Failed to add equipment';
      if (message.includes('violates row-level security') || message.includes('permission denied')) {
        toast.error('Permission denied. You need admin/manager/staff role to add equipment.');
      } else {
        toast.error('Failed to add equipment: ' + message);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!equipmentToEdit) throw new Error('Equipment not selected for edit');
      return updateEquipment(equipmentToEdit.id, {
        name: formData.name,
        brand: formData.brand || null,
        model: formData.model || null,
        serial_number: formData.serialNumber || null,
        category: formData.category || null,
        primary_category: formData.primaryCategory || null,
        muscle_groups: formData.muscleGroups,
        movement_pattern: formData.movementPattern || null,
        location: formData.location || null,
        purchase_date: formData.purchaseDate || null,
        purchase_price: formData.purchasePrice ? parseFloat(formData.purchasePrice) : null,
        warranty_expiry: formData.warrantyExpiry || null,
        notes: formData.notes || null,
      });
    },
    onSuccess: () => {
      toast.success('Equipment updated successfully');
      invalidateEquipmentQueries();
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error('Failed to update equipment: ' + (error.message || 'Unknown error'));
    },
  });

  const resetForm = () => {
    setFormData(getInitialFormData(null));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Equipment name is required');
      return;
    }
    if (!equipmentToEdit && !branchId) {
      toast.error('Branch is not selected');
      return;
    }
    if (equipmentToEdit) {
      updateMutation.mutate();
      return;
    }
    createMutation.mutate();
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isEditMode = Boolean(equipmentToEdit);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEditMode ? 'Edit Equipment' : 'Add New Equipment'}</SheetTitle>
          <SheetDescription>
            {isEditMode ? 'Update machine details and tracking metadata' : 'Add equipment to track in your gym'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Equipment Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Treadmill, Bench Press"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand">Brand</Label>
              <Input
                id="brand"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                placeholder="e.g., Life Fitness"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                placeholder="e.g., T5-GO"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="primaryCategory">Primary Category</Label>
              <Select
                value={formData.primaryCategory}
                onValueChange={(value) => setFormData({ ...formData, primaryCategory: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {PRIMARY_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="movementPattern">Movement Pattern</Label>
              <Select
                value={formData.movementPattern}
                onValueChange={(value) => setFormData({ ...formData, movementPattern: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {MOVEMENT_PATTERNS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Muscle groups multi-select — drives AI plan personalisation */}
          <div className="space-y-2">
            <Label>Muscle Groups Trained</Label>
            <p className="text-xs text-muted-foreground">
              Pick every muscle this equipment targets. The AI plan generator uses
              this to map exercises to the right machines (e.g., abs → core_abs).
            </p>
            <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto rounded-md border p-2">
              {MUSCLE_GROUPS.map((mg) => {
                const active = formData.muscleGroups.includes(mg.value);
                return (
                  <button aria-pressed={active}
                    type="button"
                    key={mg.value}
                    onClick={() =>
                      setFormData({
                        ...formData,
                        muscleGroups: active
                          ? formData.muscleGroups.filter((m) => m !== mg.value)
                          : [...formData.muscleGroups, mg.value],
                      })
                    }
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    {mg.label}
                  </button>
                );
              })}
            </div>
            {formData.muscleGroups.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {formData.muscleGroups.map((m) => (
                  <Badge key={m} variant="secondary" className="gap-1">
                    {MUSCLE_GROUPS.find((g) => g.value === m)?.label ?? m}
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          muscleGroups: formData.muscleGroups.filter((x) => x !== m),
                        })
                      }
                      aria-label={`Remove ${m}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="e.g., Cardio Zone"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="serialNumber">Serial Number</Label>
            <Input
              id="serialNumber"
              value={formData.serialNumber}
              onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
              placeholder="Equipment serial number"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchaseDate">Purchase Date</Label>
              <Input
                id="purchaseDate"
                type="date"
                value={formData.purchaseDate}
                onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
              />
            </div>
            {canViewPrice && (
              <div className="space-y-2">
                <Label htmlFor="purchasePrice">Purchase Price (₹)</Label>
                <Input
                  id="purchasePrice"
                  type="number"
                  value={formData.purchasePrice}
                  onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value })}
                  placeholder="0"
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="warrantyExpiry">Warranty Expiry</Label>
            <Input
              id="warrantyExpiry"
              type="date"
              value={formData.warrantyExpiry}
              onChange={(e) => setFormData({ ...formData, warrantyExpiry: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Optional notes about this machine"
            />
          </div>

          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (isEditMode ? 'Saving...' : 'Adding...') : (isEditMode ? 'Save Changes' : 'Add Equipment')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
