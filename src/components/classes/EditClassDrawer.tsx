import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useUpdateClass } from '@/hooks/useClasses';
import { useTrainers } from '@/hooks/useTrainers';
import { useBenefitTypes } from '@/hooks/useBenefitTypes';
import { format } from 'date-fns';
import { AlertTriangle, Phone, Mail, User, Gift, IndianRupee, Sparkles } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { ClassWithDetails } from '@/services/classService';
import { ClassBannerUpload } from './ClassBannerUpload';
import { TrainerPicker } from './TrainerPicker';

interface EditClassDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classData: ClassWithDetails | null;
  branchId: string;
}

type ChargingMode = 'free' | 'benefit' | 'paid';

export function EditClassDrawer({ open, onOpenChange, classData, branchId }: EditClassDrawerProps) {
  const updateClass = useUpdateClass();
  const { data: trainers } = useTrainers(branchId);
  const { data: benefitTypes = [] } = useBenefitTypes(branchId);

  const [mode, setMode] = useState<ChargingMode>('free');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    capacity: 20,
    duration_minutes: 60,
    scheduled_at: '',
    trainer_id: '',
    external_trainer_name: '',
    venue: '',
    banner_url: null as string | null,
    class_type: '',
    is_active: true,
    benefit_type_id: '',
    requires_benefit: true,
    price: 0,
    gst_rate: 18,
    is_gst_inclusive: true,
  });

  useEffect(() => {
    if (classData) {
      const cd = classData as any;
      const initialMode: ChargingMode = cd.is_paid ? 'paid' : (cd.benefit_type_id ? 'benefit' : 'free');
      setMode(initialMode);
      setFormData({
        name: classData.name,
        description: classData.description || '',
        capacity: classData.capacity,
        duration_minutes: classData.duration_minutes || 60,
        scheduled_at: classData.scheduled_at ? format(new Date(classData.scheduled_at), "yyyy-MM-dd'T'HH:mm") : '',
        trainer_id: classData.trainer_id || '',
        external_trainer_name: cd.external_trainer_name || '',
        venue: cd.venue || '',
        banner_url: cd.banner_url || null,
        class_type: classData.class_type || '',
        is_active: classData.is_active ?? true,
        benefit_type_id: cd.benefit_type_id || '',
        requires_benefit: cd.requires_benefit ?? true,
        price: cd.price ?? 0,
        gst_rate: cd.gst_rate ?? 18,
        is_gst_inclusive: cd.is_gst_inclusive ?? true,
      });
    }
  }, [classData]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classData || !formData.name || !formData.scheduled_at) {
      toast.error('Please fill in required fields');
      return;
    }
    if (mode === 'benefit' && !formData.benefit_type_id) {
      toast.error('Select which benefit unlocks this class');
      return;
    }
    if (mode === 'paid' && (!formData.price || formData.price <= 0)) {
      toast.error('Enter a workshop price greater than 0');
      return;
    }

    try {
      await updateClass.mutateAsync({
        classId: classData.id,
        updates: {
          name: formData.name,
          description: formData.description,
          capacity: formData.capacity,
          duration_minutes: formData.duration_minutes,
          class_type: formData.class_type,
          is_active: formData.is_active,
          trainer_id: formData.trainer_id || null,
          external_trainer_name: formData.trainer_id ? null : (formData.external_trainer_name.trim() || null),
          venue: formData.venue.trim() || null,
          banner_url: formData.banner_url,
          scheduled_at: new Date(formData.scheduled_at).toISOString(),
          benefit_type_id: mode === 'benefit' ? formData.benefit_type_id : null,
          requires_benefit: mode === 'benefit' ? formData.requires_benefit : false,
          is_paid: mode === 'paid',
          price: mode === 'paid' ? formData.price : 0,
          gst_rate: mode === 'paid' ? formData.gst_rate : 0,
          is_gst_inclusive: mode === 'paid' ? formData.is_gst_inclusive : true,
        } as any,
      });
      toast.success('Class updated successfully');
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to update class');
    }
  };

  const handleCancelClass = async () => {
    if (!classData) return;
    
    try {
      await updateClass.mutateAsync({
        classId: classData.id,
        updates: { is_active: false },
      });
      toast.success('Class cancelled successfully');
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to cancel class');
    }
  };

  const selectedTrainer = trainers?.find((t: any) => t.id === formData.trainer_id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Class</SheetTitle>
          <SheetDescription>Update class details and schedule</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Active Status Toggle */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="space-y-0.5">
              <Label className="text-base">Active Status</Label>
              <p className="text-sm text-muted-foreground">
                {formData.is_active ? 'Class is active and visible' : 'Class is cancelled/hidden'}
              </p>
            </div>
            <Switch
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
          </div>

          {/* Current Bookings Info */}
          {classData && (
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {classData.bookings_count || 0}/{classData.capacity} Booked
              </Badge>
              {(classData.waitlist_count || 0) > 0 && (
                <Badge variant="secondary">
                  {classData.waitlist_count} Waitlisted
                </Badge>
              )}
            </div>
          )}

          <Separator />

          <ClassBannerUpload
            value={formData.banner_url}
            onChange={(url) => setFormData({ ...formData, banner_url: url })}
          />


          <div className="space-y-2">
            <Label>Class Name *</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Yoga, HIIT, Spin, etc."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Class Type</Label>
              <Select
                value={formData.class_type}
                onValueChange={(value) => setFormData({ ...formData, class_type: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yoga">Yoga</SelectItem>
                  <SelectItem value="hiit">HIIT</SelectItem>
                  <SelectItem value="spin">Spin</SelectItem>
                  <SelectItem value="strength">Strength</SelectItem>
                  <SelectItem value="cardio">Cardio</SelectItem>
                  <SelectItem value="dance">Dance</SelectItem>
                  <SelectItem value="pilates">Pilates</SelectItem>
                  <SelectItem value="boxing">Boxing</SelectItem>
                  <SelectItem value="crossfit">CrossFit</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Capacity *</Label>
              <Input
                type="number"
                value={formData.capacity}
                onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 20 })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date & Time *</Label>
              <Input
                type="datetime-local"
                value={formData.scheduled_at}
                onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                value={formData.duration_minutes}
                onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) || 60 })}
              />
            </div>
          </div>

          <TrainerPicker
            trainers={trainers}
            trainerId={formData.trainer_id}
            guestName={formData.external_trainer_name}
            onChange={({ trainerId, guestName }) =>
              setFormData({ ...formData, trainer_id: trainerId, external_trainer_name: guestName })
            }
          />

          <div className="space-y-2">
            <Label htmlFor="edit-class-venue">Venue / Studio</Label>
            <Input
              id="edit-class-venue"
              value={formData.venue}
              onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
              placeholder="Main floor, Studio 2, Rooftop…"
            />
          </div>


          {/* Trainer Contact Info */}
          {selectedTrainer && (
            <div className="p-3 bg-muted rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <User className="h-4 w-4" />
                Trainer Contact
              </div>
              {selectedTrainer.profile_phone && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {selectedTrainer.profile_phone}
                </div>
              )}
              {selectedTrainer.profile_email && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  {selectedTrainer.profile_email}
                </div>
              )}
            </div>
          )}

          {/* Charging mode */}
          <div className="space-y-2 rounded-xl border p-4 bg-muted/30">
            <Label className="text-sm font-semibold">How is this class charged?</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as ChargingMode)} className="space-y-2 pt-1">
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="free" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-3.5 w-3.5" /> Free for everyone</div>
                  <p className="text-xs text-muted-foreground">Any active member can book — no quota, no charge.</p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="benefit" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium"><Gift className="h-3.5 w-3.5" /> Included in plan benefit</div>
                  <p className="text-xs text-muted-foreground">Booking consumes a member's quota.</p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="paid" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium"><IndianRupee className="h-3.5 w-3.5" /> Paid workshop</div>
                  <p className="text-xs text-muted-foreground">Auto-creates an invoice on booking.</p>
                </div>
              </label>
            </RadioGroup>
          </div>

          {mode === 'benefit' && (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="space-y-2">
                <Label>Linked Benefit *</Label>
                <Select value={formData.benefit_type_id} onValueChange={(v) => setFormData({ ...formData, benefit_type_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select a benefit" /></SelectTrigger>
                  <SelectContent>
                    {benefitTypes.map((bt: any) => (
                      <SelectItem key={bt.id} value={bt.id}>{bt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Block members without this benefit</Label>
                  <p className="text-xs text-muted-foreground">If off, anyone can book for free.</p>
                </div>
                <Switch checked={formData.requires_benefit} onCheckedChange={(v) => setFormData({ ...formData, requires_benefit: v })} />
              </div>
            </div>
          )}

          {mode === 'paid' && (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="space-y-2">
                <Label>Workshop Price (₹) *</Label>
                <Input type="number" min={0} value={formData.price} onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>GST Rate (%)</Label>
                  <Input type="number" min={0} value={formData.gst_rate} onChange={(e) => setFormData({ ...formData, gst_rate: Number(e.target.value) })} />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Switch checked={formData.is_gst_inclusive} onCheckedChange={(v) => setFormData({ ...formData, is_gst_inclusive: v })} />
                    Price includes GST
                  </label>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Class description..."
              rows={3}
            />
          </div>

          <SheetFooter className="pt-4 flex-col gap-2">
            <div className="flex gap-2 w-full">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" disabled={updateClass.isPending} className="flex-1">
                {updateClass.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
            
            {formData.is_active && classData && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleCancelClass}
                className="w-full"
                disabled={updateClass.isPending}
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Cancel This Class
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
