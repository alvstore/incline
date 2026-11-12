import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

interface EditBranchDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: any;
}

export function EditBranchDrawer({ open, onOpenChange, branch }: EditBranchDrawerProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [managerChanged, setManagerChanged] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    address: '',
    city: '',
    state: '',
    country: 'India',
    postal_code: '',
    phone: '',
    email: '',
    opening_time: '06:00',
    closing_time: '22:00',
    is_open_24_7: false,
    capacity: 50,
    is_active: true,
    managerId: '',
    gstin: '',
    google_review_link: '',
    google_place_id: '',
  });

  // Fetch the current primary manager for this branch
  const { data: currentManager } = useQuery({
    queryKey: ['branch-manager', branch?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_managers')
        .select('user_id, profiles:branch_managers_user_id_profiles_fkey(full_name)')
        .eq('branch_id', branch.id)
        .eq('is_primary', true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: open && !!branch?.id,
  });

  useEffect(() => {
    if (branch) {
      setManagerChanged(false);
      const isOpen24x7 = branch.opening_time?.startsWith('00:00') && branch.closing_time?.startsWith('23:59');
      setFormData({
        name: branch.name || '',
        code: branch.code || '',
        address: branch.address || '',
        city: branch.city || '',
        state: branch.state || '',
        country: branch.country || 'India',
        postal_code: branch.postal_code || '',
        phone: branch.phone || '',
        email: branch.email || '',
        opening_time: isOpen24x7 ? '00:00' : (branch.opening_time?.slice(0, 5) || '06:00'),
        closing_time: isOpen24x7 ? '23:59' : (branch.closing_time?.slice(0, 5) || '22:00'),
        is_open_24_7: isOpen24x7,
        capacity: branch.capacity || 50,
        is_active: branch.is_active ?? true,
        managerId: currentManager?.user_id || '',
        gstin: branch.gstin || '',
        google_review_link: branch.google_review_link || '',
        google_place_id: branch.google_place_id || '',
      });
    }
  }, [branch, currentManager]);

  const { data: potentialManagers = [] } = useQuery({
    queryKey: ['potential-managers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          role,
          profiles:user_id (full_name, email)
        `)
        .in('role', ['manager', 'admin', 'owner']);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const handleManagerChange = (value: string) => {
    const newId = value === 'none' ? '' : value;
    setFormData({ ...formData, managerId: newId });
    setManagerChanged(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branch?.id) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('branches')
        .update({
          name: formData.name,
          address: formData.address,
          city: formData.city,
          state: formData.state,
          country: formData.country,
          postal_code: formData.postal_code,
          phone: formData.phone,
          email: formData.email,
          opening_time: formData.is_open_24_7 ? '00:00' : formData.opening_time,
          closing_time: formData.is_open_24_7 ? '23:59' : formData.closing_time,
          capacity: formData.capacity,
          is_active: formData.is_active,
          gstin: formData.gstin || null,
          google_review_link: formData.google_review_link || null,
          google_place_id: formData.google_place_id || null,
        })
        .eq('id', branch.id);

      if (error) throw error;

      // Update manager only if selection changed
      if (managerChanged) {
        // Always remove existing primary manager first
        await supabase
          .from('branch_managers')
          .delete()
          .eq('branch_id', branch.id)
          .eq('is_primary', true);

        // Add new manager if one was selected
        if (formData.managerId) {
          await supabase
            .from('branch_managers')
            .insert({
              branch_id: branch.id,
              user_id: formData.managerId,
              is_primary: true,
            });

          // Also ensure staff_branches entry exists
          const { data: existing } = await supabase
            .from('staff_branches')
            .select('id')
            .eq('user_id', formData.managerId)
            .eq('branch_id', branch.id)
            .maybeSingle();

          if (!existing) {
            await supabase
              .from('staff_branches')
              .insert({
                user_id: formData.managerId,
                branch_id: branch.id,
              });
          }
        }
      }

      toast.success('Branch updated successfully');
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      queryClient.invalidateQueries({ queryKey: ['branch-manager', branch.id] });
      queryClient.invalidateQueries({ queryKey: ['potential-managers'] });
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating branch:', error);
      toast.error(error.message || 'Failed to update branch');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Branch</SheetTitle>
          <SheetDescription>Update branch details and settings</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Branch Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Branch Code</Label>
            <Input
              id="code"
              value={formData.code}
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">Code cannot be changed</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div>
                <Label htmlFor="is_open_24_7">Open 24x7</Label>
                <p className="text-xs text-muted-foreground">Saves hours as 00:00 to 23:59</p>
              </div>
              <Switch
                id="is_open_24_7"
                checked={formData.is_open_24_7}
                onCheckedChange={(checked) =>
                  setFormData({
                    ...formData,
                    is_open_24_7: checked,
                    opening_time: checked ? '00:00' : formData.opening_time,
                    closing_time: checked ? '23:59' : formData.closing_time,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="opening_time">Opening Time</Label>
              <Input
                id="opening_time"
                type="time"
                value={formData.opening_time}
                onChange={(e) => setFormData({ ...formData, opening_time: e.target.value })}
                disabled={formData.is_open_24_7}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="closing_time">Closing Time</Label>
              <Input
                id="closing_time"
                type="time"
                value={formData.closing_time}
                onChange={(e) => setFormData({ ...formData, closing_time: e.target.value })}
                disabled={formData.is_open_24_7}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postal_code">Postal Code</Label>
              <Input
                id="postal_code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <PhoneInput
                id="phone"
                value={formData.phone}
                onChange={(value) => setFormData({ ...formData, phone: value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manager">Branch Manager</Label>
            {currentManager && !managerChanged && (
              <p className="text-xs text-muted-foreground">
                Current: <span className="font-medium text-foreground">{(currentManager as any).profiles?.full_name || 'Unknown'}</span>
              </p>
            )}
            <Select
              value={formData.managerId || "none"}
              onValueChange={handleManagerChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a manager" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No manager assigned</SelectItem>
                {potentialManagers.map((m: any) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.profiles?.full_name || m.profiles?.email} ({m.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only users with Manager, Admin, or Owner roles appear here. Assign roles via Admin Roles page.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="capacity">Branch Capacity</Label>
            <Input
              id="capacity"
              type="number"
              min={1}
              value={formData.capacity}
              onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 50 })}
            />
            <p className="text-xs text-muted-foreground">Maximum occupancy for the Live Occupancy gauge on Dashboard</p>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <Label htmlFor="is_active">Branch Active</Label>
              <p className="text-xs text-muted-foreground">Inactive branches won't accept check-ins</p>
            </div>
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gstin">GSTIN</Label>
            <Input
              id="gstin"
              value={formData.gstin}
              onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
              placeholder="e.g., 08AABCU9603R1ZM"
              maxLength={15}
            />
            <p className="text-xs text-muted-foreground">GST Identification Number for tax invoices</p>
          </div>

          {/* Google Reviews */}
          <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
            <div>
              <Label className="text-sm font-semibold">Google Reviews</Label>
              <p className="text-xs text-muted-foreground">
                Customers post reviews on Google themselves — paste your branch's "Get more reviews" short link here.
                We'll use it for review requests and the printable QR.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="google_review_link">Google review link</Label>
              <Input
                id="google_review_link"
                type="url"
                value={formData.google_review_link}
                onChange={(e) => setFormData({ ...formData, google_review_link: e.target.value })}
                placeholder="https://g.page/r/..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="google_place_id">Google Place ID (optional)</Label>
              <Input
                id="google_place_id"
                value={formData.google_place_id}
                onChange={(e) => setFormData({ ...formData, google_place_id: e.target.value })}
                placeholder="ChIJ..."
              />
              <p className="text-xs text-muted-foreground">Needed only to fetch existing Google reviews via API.</p>
            </div>
            {formData.google_review_link && (
              <div className="flex items-center gap-3 pt-1">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(formData.google_review_link)}`}
                  alt="Google review QR"
                  className="h-24 w-24 rounded-md border bg-card p-1"
                />
                <div className="text-xs text-muted-foreground">
                  Scan-to-review QR. Print this and place it at the front desk or in the changing rooms.
                </div>
              </div>
            )}
          </div>

          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}