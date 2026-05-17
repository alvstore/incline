import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { useUpdatePTPackage } from '@/hooks/usePTPackages';
import { Package, Calendar } from 'lucide-react';

const SESSION_TYPES = [
  { value: 'per_session', label: 'Per Session' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'custom', label: 'Custom' },
];

interface EditPTPackageDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  package: any;
}

export function EditPTPackageDrawer({ open, onOpenChange, package: pkg }: EditPTPackageDrawerProps) {
  const updatePackage = useUpdatePTPackage();
  const [formData, setFormData] = useState({
    name: '', description: '', total_sessions: 10, price: 0, validity_days: 90,
    session_type: 'per_session',
    gst_enabled: false, gst_inclusive: false, gst_percentage: 18, is_active: true,
    package_type: 'session_based' as 'session_based' | 'duration_based',
    duration_months: 3,
  });

  useEffect(() => {
    if (pkg) {
      const pct = Number(pkg.gst_percentage ?? 0);
      setFormData({
        name: pkg.name || '', description: pkg.description || '',
        total_sessions: pkg.total_sessions || 10, price: pkg.price || 0,
        validity_days: pkg.validity_days || 90, session_type: pkg.session_type || 'per_session',
        gst_enabled: pct > 0,
        gst_inclusive: pkg.gst_inclusive || false,
        gst_percentage: pct > 0 ? pct : 18,
        is_active: pkg.is_active !== false,
        package_type: pkg.package_type || 'session_based',
        duration_months: pkg.duration_months || 3,
      });
    }
  }, [pkg]);

  const isDurationBased = formData.package_type === 'duration_based';

  const calculateGSTAmount = (price: number, gstPercentage: number, isInclusive: boolean) => {
    if (isInclusive) return price - (price / (1 + gstPercentage / 100));
    return price * (gstPercentage / 100);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.price) {
      toast.error('Please fill in required fields');
      return;
    }

    try {
      const payload: any = {
        id: pkg.id,
        ...formData,
        gst_percentage: formData.gst_enabled ? formData.gst_percentage : 0,
        gst_inclusive: formData.gst_enabled ? formData.gst_inclusive : false,
      };
      delete payload.gst_enabled;
      if (isDurationBased) {
        payload.total_sessions = 0;
        payload.validity_days = formData.duration_months * 30;
      } else {
        payload.duration_months = null;
      }

      await updatePackage.mutateAsync(payload);
      toast.success('PT Package updated');
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to update package');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit PT Package</SheetTitle>
          <SheetDescription>Update package details</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Package Name *</Label>
            <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
          </div>

          {/* Package Type Toggle */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Package Type</Label>
            <RadioGroup
              value={formData.package_type}
              onValueChange={(v) => setFormData({ ...formData, package_type: v as any })}
              className="grid grid-cols-2 gap-3"
            >
              <Label htmlFor="edit-session"
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  !isDurationBased ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <RadioGroupItem value="session_based" id="edit-session" className="sr-only" />
                <Package className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium">Session Pack</span>
              </Label>
              <Label htmlFor="edit-duration"
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  isDurationBased ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <RadioGroupItem value="duration_based" id="edit-duration" className="sr-only" />
                <Calendar className="h-5 w-5 text-accent" />
                <span className="text-xs font-medium">Monthly Duration</span>
              </Label>
            </RadioGroup>
          </div>

          {!isDurationBased ? (
            <>
              <div className="space-y-2">
                <Label>Session Type *</Label>
                <Select value={formData.session_type} onValueChange={(v) => setFormData({ ...formData, session_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SESSION_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Sessions *</Label>
                  <Input type="number" value={formData.total_sessions}
                    onChange={(e) => setFormData({ ...formData, total_sessions: parseInt(e.target.value) || 10 })} />
                </div>
                <div className="space-y-2">
                  <Label>Price (₹) *</Label>
                  <Input type="number" value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Validity (days)</Label>
                <Input type="number" value={formData.validity_days}
                  onChange={(e) => setFormData({ ...formData, validity_days: parseInt(e.target.value) || 90 })} />
              </div>
            </>
          ) : (
            <div className="space-y-4 p-4 border rounded-lg bg-accent/5 border-accent/20">
              <h4 className="text-sm font-medium">Duration Package</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Duration (Months) *</Label>
                  <Input type="number" min={1} max={24} value={formData.duration_months}
                    onChange={(e) => setFormData({ ...formData, duration_months: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="space-y-2">
                  <Label>Total Price (₹) *</Label>
                  <Input type="number" value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              {formData.price > 0 && formData.duration_months > 0 && (
                <p className="text-xs text-muted-foreground">≈ ₹{Math.round(formData.price / formData.duration_months).toLocaleString()}/month</p>
              )}
            </div>
          )}

          <div className="space-y-3 p-4 rounded-xl border bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-semibold">Charge GST</Label>
                <p className="text-xs text-muted-foreground">PT is GST-exempt by default.</p>
              </div>
              <Switch checked={formData.gst_enabled}
                onCheckedChange={(v) => setFormData({ ...formData, gst_enabled: v })} />
            </div>
            {formData.gst_enabled && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>GST %</Label>
                  <Input type="number" value={formData.gst_percentage}
                    onChange={(e) => setFormData({ ...formData, gst_percentage: parseFloat(e.target.value) || 18 })} />
                </div>
                <div className="flex items-center gap-3 pt-6">
                  <Switch checked={formData.gst_inclusive} onCheckedChange={(v) => setFormData({ ...formData, gst_inclusive: v })} />
                  <Label>GST Inclusive</Label>
                </div>
              </div>
            )}
          </div>

          {formData.price > 0 && formData.gst_enabled && (
            <div className="p-3 rounded-lg bg-muted text-sm space-y-1">
              <p><strong>Base Price:</strong> ₹{formData.gst_inclusive
                ? (formData.price - calculateGSTAmount(formData.price, formData.gst_percentage, true)).toFixed(2)
                : formData.price}</p>
              <p><strong>GST ({formData.gst_percentage}%):</strong> ₹{calculateGSTAmount(formData.price, formData.gst_percentage, formData.gst_inclusive).toFixed(2)}</p>
              <p className="font-bold"><strong>Total:</strong> ₹{formData.gst_inclusive
                ? formData.price
                : (formData.price + calculateGSTAmount(formData.price, formData.gst_percentage, false)).toFixed(2)}</p>
            </div>
          )}
          {formData.price > 0 && !formData.gst_enabled && (
            <div className="p-3 rounded-lg bg-muted text-sm">
              <p className="font-bold">Total: ₹{formData.price} <span className="font-normal text-muted-foreground">(GST not applied)</span></p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Package details..." />
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div>
              <Label htmlFor="is-active">Package Status</Label>
              <p className="text-sm text-muted-foreground">{formData.is_active ? 'Active - available for purchase' : 'Inactive - hidden'}</p>
            </div>
            <Switch id="is-active" checked={formData.is_active} onCheckedChange={(v) => setFormData({ ...formData, is_active: v })} />
          </div>

          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={updatePackage.isPending}>
              {updatePackage.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
