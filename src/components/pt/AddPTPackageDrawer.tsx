import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { useCreatePTPackage } from '@/hooks/usePTPackages';
import { useGstRates } from '@/hooks/useGstRates';
import { Package, Calendar } from 'lucide-react';

const SESSION_TYPES = [
  { value: 'per_session', label: 'Per Session (Fixed sessions)' },
  { value: 'monthly', label: 'Monthly Subscription' },
  { value: 'quarterly', label: 'Quarterly Subscription' },
  { value: 'custom', label: 'Custom' },
];

interface AddPTPackageDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
}

export function AddPTPackageDrawer({ open, onOpenChange, branchId }: AddPTPackageDrawerProps) {
  const createPackage = useCreatePTPackage();
  const { data: gstRates = [5, 12, 18, 28] } = useGstRates();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    total_sessions: 10,
    sessions_per_month: 8,
    price: 0,
    validity_days: 90,
    session_type: 'per_session',
    auto_renew: false,
    gst_enabled: false,           // PT is GST-exempt by default
    gst_inclusive: false,
    gst_percentage: 18,
    package_type: 'session_based' as 'session_based' | 'monthly',
    duration_months: 3,
  });

  const effectiveGstPct = formData.gst_enabled ? formData.gst_percentage : 0;

  const isSubscription = formData.session_type === 'monthly' || formData.session_type === 'quarterly';
  const isDurationBased = formData.package_type === 'monthly';

  const calculateGSTAmount = (price: number, gstPercentage: number, isInclusive: boolean) => {
    if (isInclusive) {
      return price - (price / (1 + gstPercentage / 100));
    }
    return price * (gstPercentage / 100);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.price || !branchId) {
      toast.error('Please fill in required fields');
      return;
    }

    try {
      const payload: any = {
        name: formData.name,
        description: formData.description,
        price: formData.price,
        session_type: formData.session_type,
        gst_inclusive: formData.gst_inclusive,
        gst_percentage: formData.gst_percentage,
        package_type: formData.package_type,
        branch_id: branchId,
      };

      if (isDurationBased) {
        payload.total_sessions = 0;
        payload.duration_months = formData.duration_months;
        payload.validity_days = formData.duration_months * 30;
      } else {
        payload.total_sessions = formData.total_sessions;
        payload.validity_days = formData.validity_days;
        payload.duration_months = null;
      }

      if (isSubscription) {
        payload.sessions_per_month = formData.sessions_per_month;
      }

      await createPackage.mutateAsync(payload);
      toast.success('PT Package created');
      onOpenChange(false);
      resetForm();
    } catch (error) {
      toast.error('Failed to create package');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '', description: '', total_sessions: 10, sessions_per_month: 8,
      price: 0, validity_days: 90, session_type: 'per_session',
      auto_renew: false, gst_inclusive: false, gst_percentage: 18,
      package_type: 'session_based' as 'session_based' | 'monthly', duration_months: 3,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create PT Package</SheetTitle>
          <SheetDescription>Define a new personal training package</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Package Name *</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="10 Sessions Package"
              required
            />
          </div>

          {/* Package Type Toggle */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Package Type *</Label>
              <RadioGroup
                value={formData.package_type}
                onValueChange={(v) => setFormData({ ...formData, package_type: v as 'session_based' | 'monthly' })}
                className="grid grid-cols-2 gap-3"
              >
                <Label
                  htmlFor="session_based"
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    formData.package_type === 'session_based' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <RadioGroupItem value="session_based" id="session_based" className="sr-only" />
                  <Package className="h-6 w-6 text-primary" />
                  <span className="text-sm font-medium">Session Pack</span>
                  <span className="text-xs text-muted-foreground text-center">Fixed number of sessions</span>
                </Label>
                <Label
                  htmlFor="monthly"
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    formData.package_type === 'monthly' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <RadioGroupItem value="monthly" id="monthly" className="sr-only" />
                  <Calendar className="h-6 w-6 text-accent" />
                  <span className="text-sm font-medium">Monthly Plan</span>
                  <span className="text-xs text-muted-foreground text-center">Time-based (e.g., 3 months)</span>
                </Label>
              </RadioGroup>
          </div>

          {!isDurationBased && (
            <div className="space-y-2">
              <Label>Session Type *</Label>
              <Select
                value={formData.session_type}
                onValueChange={(v) => setFormData({ ...formData, session_type: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SESSION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Session-based fields */}
          {!isDurationBased && !isSubscription && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Total Sessions *</Label>
                <Input type="number" value={formData.total_sessions}
                  onChange={(e) => setFormData({ ...formData, total_sessions: parseInt(e.target.value) || 10 })} />
              </div>
              <div className="space-y-2">
                <Label>Price (₹) *</Label>
                <Input type="number" value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
          )}

          {/* Subscription fields */}
          {!isDurationBased && isSubscription && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <h4 className="text-sm font-medium">Subscription Details</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Sessions per Month *</Label>
                  <Input type="number" value={formData.sessions_per_month}
                    onChange={(e) => setFormData({ ...formData, sessions_per_month: parseInt(e.target.value) || 8 })} />
                </div>
                <div className="space-y-2">
                  <Label>Monthly Price (₹) *</Label>
                  <Input type="number" value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
            </div>
          )}

          {/* Duration-based fields */}
          {isDurationBased && (
            <div className="space-y-4 p-4 border rounded-lg bg-accent/5 border-accent/20">
              <h4 className="text-sm font-medium">Duration Package Details</h4>
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
                <p className="text-xs text-muted-foreground">
                  ≈ ₹{Math.round(formData.price / formData.duration_months).toLocaleString()}/month
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>GST %</Label>
              <Input type="number" value={formData.gst_percentage}
                onChange={(e) => setFormData({ ...formData, gst_percentage: parseFloat(e.target.value) || 18 })} />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch checked={formData.gst_inclusive}
                onCheckedChange={(v) => setFormData({ ...formData, gst_inclusive: v })} />
              <Label>GST Inclusive</Label>
            </div>
          </div>

          {formData.price > 0 && (
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

          {!isDurationBased && (
            <div className="space-y-2">
              <Label>Validity (days)</Label>
              <Input type="number" value={formData.validity_days}
                onChange={(e) => setFormData({ ...formData, validity_days: parseInt(e.target.value) || 90 })} />
            </div>
          )}

          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Package details..." />
          </div>

          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createPackage.isPending}>
              {createPackage.isPending ? 'Creating...' : 'Create Package'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
