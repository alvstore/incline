import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, MapPin, Clock, Phone, Mail, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface AddBranchDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddBranchDrawer({ open, onOpenChange }: AddBranchDrawerProps) {
  const { hasAnyRole } = useAuth();
  const canCreateBranch = hasAnyRole(['owner', 'admin']);

  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    address: '',
    city: '',
    state: '',
    country: 'India',
    postalCode: '',
    phone: '',
    email: '',
    openingTime: '06:00',
    closingTime: '22:00',
    isOpen24x7: false,
    timezone: 'Asia/Kolkata',
    managerId: '',
  });
  const queryClient = useQueryClient();

  // Fetch users who can be managers
  const { data: potentialManagers = [] } = useQuery({
    queryKey: ['potential-managers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          role,
          profiles:user_id(id, full_name, email)
        `)
        .in('role', ['owner', 'admin', 'manager']);

      if (error) throw error;
      return data;
    },
  });

  const createBranch = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Uniqueness pre-check on code
      const codeUpper = data.code.toUpperCase();
      const { data: existing } = await supabase
        .from('branches')
        .select('id')
        .eq('code', codeUpper)
        .maybeSingle();
      if (existing) {
        throw new Error(`Branch code "${codeUpper}" is already in use. Try a different code.`);
      }

      // Create branch
      const { data: branch, error: branchError } = await supabase
        .from('branches')
        .insert({
          name: data.name,
          code: codeUpper,
          address: data.address,
          city: data.city,
          state: data.state,
          country: data.country,
          postal_code: data.postalCode,
          phone: data.phone,
          email: data.email,
          opening_time: data.isOpen24x7 ? '00:00' : data.openingTime,
          closing_time: data.isOpen24x7 ? '23:59' : data.closingTime,
          timezone: data.timezone,
          is_active: true,
        })
        .select()
        .single();

      if (branchError) throw branchError;

      // Create branch settings
      await supabase.from('branch_settings').insert({
        branch_id: branch.id,
        currency: 'INR',
        tax_rate: 18,
        freeze_fee: 500,
        freeze_min_days: 7,
        freeze_max_days: 30,
        late_fee_rate: 5,
        cancellation_fee_rate: 10,
        auto_attendance_checkout: true,
        checkout_after_hours: 4,
        waitlist_enabled: true,
        advance_booking_days: 7,
      });

      // Assign manager if selected
      if (data.managerId) {
        await supabase.from('branch_managers').insert({
          branch_id: branch.id,
          user_id: data.managerId,
          is_primary: true,
        });

        // Also add to staff_branches
        await supabase.from('staff_branches').insert({
          branch_id: branch.id,
          user_id: data.managerId,
        });
      }

      return branch;
    },
    onSuccess: () => {
      toast.success('Branch created successfully');
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      queryClient.invalidateQueries({ queryKey: ['potential-managers'] });
      queryClient.invalidateQueries({ queryKey: ['branch-manager'] });
      onOpenChange(false);
      setFormData({
        name: '',
        code: '',
        address: '',
        city: '',
        state: '',
        country: 'India',
        postalCode: '',
        phone: '',
        email: '',
        openingTime: '06:00',
        closingTime: '22:00',
        isOpen24x7: false,
        timezone: 'Asia/Kolkata',
        managerId: '',
      });
      setCodeManuallyEdited(false);
    },
    onError: (error: any) => {
      const message = error?.message || error?.error_description || 'Failed to create branch';
      toast.error(message);
      console.error('Create branch error:', error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateBranch) {
      toast.error('Only Owner/Admin can create branches');
      return;
    }
    if (!formData.name || !formData.code) {
      toast.error('Please fill in required fields');
      return;
    }
    createBranch.mutate(formData);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Add New Branch
          </SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Branch Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setFormData((prev) => ({
                    ...prev,
                    name,
                    // Auto-suggest code from first 3 alpha chars while user hasn't manually edited it
                    code: codeManuallyEdited
                      ? prev.code
                      : name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(),
                  }));
                }}
                placeholder="e.g., Incline Bandra"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Branch Code *</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => {
                  setCodeManuallyEdited(true);
                  setFormData({ ...formData, code: e.target.value.toUpperCase() });
                }}
                placeholder="Auto from name (e.g., INC)"
                maxLength={6}
                required
              />
              <p className="text-xs text-muted-foreground">Used in member codes (e.g., {formData.code || 'INC'}-26-0001) and invoice numbers.</p>
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Address
            </Label>
            <Input
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="Street address"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="e.g., Mumbai"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="e.g., Maharashtra"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="postalCode">Postal Code</Label>
              <Input
                id="postalCode"
                value={formData.postalCode}
                onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                placeholder="e.g., 400001"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone
              </Label>
              <PhoneInput
                value={formData.phone}
                onChange={(value) => setFormData({ ...formData, phone: value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="branch@gym.com"
              />
            </div>
          </div>

          {/* Operating Hours */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
            <div>
              <Label htmlFor="is_open_24_7">Open 24x7</Label>
              <p className="text-xs text-muted-foreground">Saves hours as 00:00 to 23:59</p>
            </div>
            <Switch
              id="is_open_24_7"
              checked={formData.isOpen24x7}
              onCheckedChange={(checked) =>
                setFormData({
                  ...formData,
                  isOpen24x7: checked,
                  openingTime: checked ? '00:00' : formData.openingTime,
                  closingTime: checked ? '23:59' : formData.closingTime,
                })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Opening Time
              </Label>
              <Input
                type="time"
                value={formData.openingTime}
                onChange={(e) => setFormData({ ...formData, openingTime: e.target.value })}
                disabled={formData.isOpen24x7}
              />
            </div>
            <div className="space-y-2">
              <Label>Closing Time</Label>
              <Input
                type="time"
                value={formData.closingTime}
                onChange={(e) => setFormData({ ...formData, closingTime: e.target.value })}
                disabled={formData.isOpen24x7}
              />
            </div>
          </div>

          {/* Manager Assignment */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Assign Manager
            </Label>
            <Select 
              value={formData.managerId || "none"} 
              onValueChange={(v) => setFormData({ ...formData, managerId: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a manager (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No manager</SelectItem>
                {potentialManagers.map((m: any) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.profiles?.full_name || m.profiles?.email} ({m.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={createBranch.isPending}>
              {createBranch.isPending ? 'Creating...' : 'Create Branch'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
