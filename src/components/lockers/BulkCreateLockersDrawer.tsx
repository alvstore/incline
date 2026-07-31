import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface BulkCreateLockersDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
}

const ZONE_OPTIONS = [
  { value: 'male', label: 'Male room' },
  { value: 'female', label: 'Female room' },
  { value: 'common', label: 'Common area' },
];

export function BulkCreateLockersDrawer({ open, onOpenChange, branchId }: BulkCreateLockersDrawerProps) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [isChargeable, setIsChargeable] = useState(false);
  const [formData, setFormData] = useState({
    prefix: 'L',
    startNumber: 1,
    endNumber: 10,
    size: 'medium',
    monthlyFee: 0,
    area: '',
    genderZone: 'common',
  });


  const previewLockers = () => {
    const lockers = [];
    for (let i = formData.startNumber; i <= formData.endNumber; i++) {
      lockers.push(`${formData.prefix}-${i.toString().padStart(3, '0')}`);
    }
    return lockers;
  };

  const lockersToCreate = previewLockers();
  const lockerCount = lockersToCreate.length;

  const handleSubmit = async () => {
    if (lockerCount === 0 || lockerCount > 100) {
      toast.error('Please select between 1 and 100 lockers');
      return;
    }

    if (isChargeable && formData.monthlyFee <= 0) {
      toast.error('Please enter a valid monthly fee for chargeable lockers');
      return;
    }

    setIsCreating(true);
    try {
      const fee = isChargeable ? formData.monthlyFee : 0;
      const lockersData = lockersToCreate.map(lockerNumber => ({
        branch_id: branchId,
        locker_number: lockerNumber,
        size: formData.size,
        monthly_fee: fee,
        location: formData.area.trim() || null,
        gender_zone: formData.genderZone,
        status: 'available' as const,
      }));

      const { data, error } = await supabase
        .from('lockers')
        .insert(lockersData)
        .select();

      if (error) {
        console.error('Bulk locker create error:', error);
        throw error;
      }

      toast.success(`Successfully created ${lockerCount} lockers`);
      queryClient.invalidateQueries({ queryKey: ['lockers'] });
      onOpenChange(false);
      setFormData({
        prefix: 'L',
        startNumber: 1,
        endNumber: 10,
        size: 'medium',
        monthlyFee: 0,
        area: '',
        genderZone: 'common',
      });

      setIsChargeable(false);
    } catch (error: any) {
      console.error('Error creating lockers:', error);
      toast.error(error.message || 'Failed to create lockers');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Bulk Create Lockers</SheetTitle>
          <SheetDescription>
            Create multiple lockers at once with a common prefix and numbering
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Prefix</Label>
              <Input
                value={formData.prefix}
                onChange={(e) => setFormData({ ...formData, prefix: e.target.value.toUpperCase() })}
                placeholder="L"
                maxLength={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Start Number</Label>
              <Input
                type="number"
                min={1}
                value={formData.startNumber}
                onChange={(e) => setFormData({ ...formData, startNumber: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="space-y-2">
              <Label>End Number</Label>
              <Input
                type="number"
                min={formData.startNumber}
                value={formData.endNumber}
                onChange={(e) => setFormData({ ...formData, endNumber: parseInt(e.target.value) || 1 })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Size (all)</Label>
            <Select
              value={formData.size}
              onValueChange={(value) => setFormData({ ...formData, size: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="large">Large</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-locker-area">Area / Location (all)</Label>
            <Input
              id="bulk-locker-area"
              value={formData.area}
              onChange={(e) => setFormData({ ...formData, area: e.target.value })}
              placeholder="e.g. Men's Changing Room"
            />
          </div>

          <div className="space-y-2">
            <Label>Zone (all)</Label>
            <Select
              value={formData.genderZone}
              onValueChange={(value) => setFormData({ ...formData, genderZone: value })}
            >
              <SelectTrigger aria-label="Zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONE_OPTIONS.map((z) => (
                  <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>


          {/* Chargeable Toggle */}
          <div className="flex items-center justify-between py-2 px-3 border rounded-lg bg-muted/30">
            <div>
              <Label>Is Chargeable?</Label>
              <p className="text-xs text-muted-foreground">Enable to set a monthly rental fee</p>
            </div>
            <Switch
              checked={isChargeable}
              onCheckedChange={setIsChargeable}
            />
          </div>

          {isChargeable && (
            <div className="space-y-2 ml-4 p-3 border rounded-lg bg-muted/30">
              <Label>Monthly Fee (₹) *</Label>
              <Input
                type="number"
                min={1}
                value={formData.monthlyFee}
                onChange={(e) => setFormData({ ...formData, monthlyFee: parseFloat(e.target.value) || 0 })}
                placeholder="Enter monthly fee"
              />
            </div>
          )}

          {/* Preview */}
          <div className="space-y-2">
            <Label>Preview ({lockerCount} lockers)</Label>
            <ScrollArea className="h-32 border rounded-lg p-3">
              <div className="flex flex-wrap gap-2">
                {lockersToCreate.slice(0, 50).map((locker) => (
                  <Badge key={locker} variant="secondary" className="text-xs">
                    {locker}
                  </Badge>
                ))}
                {lockerCount > 50 && (
                  <Badge variant="outline" className="text-xs">
                    +{lockerCount - 50} more
                  </Badge>
                )}
              </div>
            </ScrollArea>
          </div>

          {lockerCount > 100 && (
            <p className="text-sm text-destructive">Maximum 100 lockers can be created at once</p>
          )}
        </div>

        <SheetFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isCreating || lockerCount === 0 || lockerCount > 100}
          >
            {isCreating ? 'Creating...' : `Create ${lockerCount} Lockers`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
