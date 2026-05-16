import { useState, useEffect } from 'react';
import { getTrainer } from '@/services/trainerService';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useUpdateTrainer } from '@/hooks/useTrainers';
import { StaffAvatarUpload } from '@/components/common/StaffAvatarUpload';
import { queueTrainerSync } from '@/services/biometricService';
import { supabase } from '@/integrations/supabase/client';
import { StaffBiometricsTab } from '@/components/common/StaffBiometricsTab';

interface EditTrainerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trainer: any;
}

const SPECIALIZATION_OPTIONS = [
  'Weight Training', 'Cardio', 'HIIT', 'Yoga', 'Pilates', 
  'CrossFit', 'Boxing', 'Zumba', 'Strength Training', 'Functional Training',
  'Calisthenics', 'Martial Arts', 'Swimming', 'Sports Conditioning'
];

const SALARY_TYPES = [
  { value: 'fixed', label: 'Fixed Monthly' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'commission', label: 'Commission Only' },
  { value: 'hybrid', label: 'Fixed + Commission' },
];

export function EditTrainerDrawer({ open, onOpenChange, trainer }: EditTrainerDrawerProps) {
  const updateTrainer = useUpdateTrainer();
  
  const [avatarUrl, setAvatarUrl] = useState('');
  const [formData, setFormData] = useState({
    bio: '',
    hourly_rate: 0,
    max_clients: 10,
    fixed_salary: 0,
    salary_type: 'fixed',
    pt_share_percentage: 50,
    specializations: [] as string[],
    certifications: [] as string[],
    government_id: '',
    is_active: true,
  });
  const [profileData, setProfileData] = useState({
    full_name: '',
    phone: '',
    gender: '',
    date_of_birth: '',
    address: '',
    city: '',
    state: '',
    postal_code: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  });
  
  const [newCertification, setNewCertification] = useState('');

  // Handle avatar changes and queue biometric sync
  const handleAvatarChange = async (url: string) => {
    setAvatarUrl(url);
    if (url && trainer?.id) {
      // Update profile avatar
      if (trainer.user_id) {
        await supabase.from('profiles').update({ avatar_url: url }).eq('id', trainer.user_id);
      }
      // Queue biometric sync
      try {
        await queueTrainerSync(trainer.id, url, trainer.profile_name || 'Trainer');
      } catch (err) {
        console.warn('Biometric sync queue failed:', err);
      }
    }
  };

  // Defense in depth: refetch the trainer (with full profile) when the drawer opens,
  // because some callers (e.g. HRM page) pass a thin record that lacks address/dob/etc.
  useEffect(() => {
    if (!open || !trainer?.id) return;
    let cancelled = false;
    (async () => {
      const fresh = (await getTrainer(trainer.id).catch(() => null)) || trainer;
      if (cancelled) return;
      setAvatarUrl(fresh.profile_avatar || fresh.biometric_photo_url || '');
      setFormData({
        bio: fresh.bio || '',
        hourly_rate: fresh.hourly_rate || 0,
        max_clients: fresh.max_clients || 10,
        fixed_salary: fresh.fixed_salary || 0,
        salary_type: fresh.salary_type || 'fixed',
        pt_share_percentage: fresh.pt_share_percentage || 50,
        specializations: fresh.specializations || [],
        certifications: fresh.certifications || [],
        government_id: fresh.government_id || (fresh as any).government_id_number || fresh.profile?.government_id_number || '',
        is_active: fresh.is_active ?? true,
      });
      setProfileData({
        full_name: fresh.profile_name || fresh.profile?.full_name || '',
        phone: fresh.profile_phone || fresh.profile?.phone || '',
        gender: fresh.profile?.gender || '',
        date_of_birth: fresh.profile?.date_of_birth || '',
        address: fresh.profile?.address || '',
        city: fresh.profile?.city || '',
        state: fresh.profile?.state || '',
        postal_code: fresh.profile?.postal_code || '',
        emergency_contact_name: fresh.profile?.emergency_contact_name || '',
        emergency_contact_phone: fresh.profile?.emergency_contact_phone || '',
      });
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trainer?.id]);

  const handleSpecializationToggle = (spec: string) => {
    setFormData(prev => ({
      ...prev,
      specializations: prev.specializations.includes(spec)
        ? prev.specializations.filter(s => s !== spec)
        : [...prev.specializations, spec],
    }));
  };

  const addCertification = () => {
    if (newCertification.trim() && !formData.certifications.includes(newCertification.trim())) {
      setFormData(prev => ({
        ...prev,
        certifications: [...prev.certifications, newCertification.trim()],
      }));
      setNewCertification('');
    }
  };

  const removeCertification = (cert: string) => {
    setFormData(prev => ({
      ...prev,
      certifications: prev.certifications.filter(c => c !== cert),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trainer?.id) return;

    try {
      await updateTrainer.mutateAsync({
        trainerId: trainer.id,
        updates: {
          bio: formData.bio || null,
          hourly_rate: formData.hourly_rate,
          max_clients: formData.max_clients,
          fixed_salary: formData.fixed_salary,
          salary_type: formData.salary_type,
          pt_share_percentage: formData.pt_share_percentage,
          specializations: formData.specializations,
          certifications: formData.certifications,
          government_id_number: formData.government_id || null,
          is_active: formData.is_active,
        },
      });

      if (trainer.user_id) {
        const { error: profErr } = await supabase
          .from('profiles')
          .update({
            full_name: profileData.full_name || null,
            phone: profileData.phone || null,
            gender: (profileData.gender as any) || null,
            date_of_birth: profileData.date_of_birth || null,
            address: profileData.address || null,
            city: profileData.city || null,
            state: profileData.state || null,
            postal_code: profileData.postal_code || null,
            emergency_contact_name: profileData.emergency_contact_name || null,
            emergency_contact_phone: profileData.emergency_contact_phone || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', trainer.user_id);
        if (profErr) throw profErr;
      }

      toast.success('Trainer updated successfully');
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update trainer');
    }
  };

  if (!trainer) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Trainer</SheetTitle>
          <SheetDescription>
            Update {trainer.profile_name}'s profile and compensation
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          {/* Avatar Upload */}
          <div className="flex justify-center pb-2">
            <StaffAvatarUpload
              avatarUrl={avatarUrl}
              name={trainer?.profile_name || 'Trainer'}
              onAvatarChange={handleAvatarChange}
              size="lg"
            />
          </div>

          {/* Active Status */}
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
            <div>
              <Label className="font-medium">Active Status</Label>
              <p className="text-xs text-muted-foreground">Deactivating hides trainer from assignments</p>
            </div>
            <Switch
              checked={formData.is_active}
              onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
            />
          </div>

          {/* Personal Details */}
          <div className="space-y-3 p-4 border rounded-lg">
            <div className="rounded-md bg-indigo-50 border border-indigo-200 p-2.5 text-xs text-indigo-900">
              Personal details are shared with the Employee/HRM record (one master profile). Changes here update everywhere.
            </div>
            <h4 className="font-medium text-sm">Personal Details</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Full Name</Label>
                <Input
                  value={profileData.full_name}
                  onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={profileData.phone}
                  onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                  placeholder="+91…"
                />
              </div>
              <div className="space-y-2">
                <Label>Gender</Label>
                <Select
                  value={profileData.gender || 'unspecified'}
                  onValueChange={(v) => setProfileData({ ...profileData, gender: v === 'unspecified' ? '' : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unspecified">—</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date of Birth</Label>
                <Input
                  type="date"
                  value={profileData.date_of_birth}
                  onChange={(e) => setProfileData({ ...profileData, date_of_birth: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Postal Code</Label>
                <Input
                  value={profileData.postal_code}
                  onChange={(e) => setProfileData({ ...profileData, postal_code: e.target.value })}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Address</Label>
                <Textarea
                  rows={2}
                  value={profileData.address}
                  onChange={(e) => setProfileData({ ...profileData, address: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={profileData.city}
                  onChange={(e) => setProfileData({ ...profileData, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input
                  value={profileData.state}
                  onChange={(e) => setProfileData({ ...profileData, state: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Emergency Contact Name</Label>
                <Input
                  value={profileData.emergency_contact_name}
                  onChange={(e) => setProfileData({ ...profileData, emergency_contact_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Emergency Contact Phone</Label>
                <Input
                  value={profileData.emergency_contact_phone}
                  onChange={(e) => setProfileData({ ...profileData, emergency_contact_phone: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <Label>Bio</Label>
            <Textarea
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              placeholder="Professional background and experience..."
              rows={3}
            />
          </div>

          {/* Specializations */}
          <div className="space-y-2">
            <Label>Specializations</Label>
            <div className="flex flex-wrap gap-2">
              {SPECIALIZATION_OPTIONS.map((spec) => (
                <Badge
                  key={spec}
                  variant={formData.specializations.includes(spec) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => handleSpecializationToggle(spec)}
                >
                  {spec}
                </Badge>
              ))}
            </div>
          </div>

          {/* Certifications */}
          <div className="space-y-2">
            <Label>Certifications</Label>
            <div className="flex gap-2">
              <Input
                value={newCertification}
                onChange={(e) => setNewCertification(e.target.value)}
                placeholder="Add certification..."
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCertification())}
              />
              <Button type="button" variant="outline" onClick={addCertification}>
                Add
              </Button>
            </div>
            {formData.certifications.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.certifications.map((cert) => (
                  <Badge key={cert} variant="secondary" className="gap-1">
                    {cert}
                    <X 
                      className="h-3 w-3 cursor-pointer hover:text-destructive" 
                      onClick={() => removeCertification(cert)} 
                    />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Capacity */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Clients</Label>
              <Input
                type="number"
                value={formData.max_clients}
                onChange={(e) => setFormData({ ...formData, max_clients: parseInt(e.target.value) || 10 })}
              />
            </div>
            <div className="space-y-2">
              <Label>Hourly Rate (₹)</Label>
              <Input
                type="number"
                value={formData.hourly_rate}
                onChange={(e) => setFormData({ ...formData, hourly_rate: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>

          {/* Compensation */}
          <div className="space-y-4 p-4 border rounded-lg">
            <h4 className="font-medium">Compensation</h4>
            
            <div className="space-y-2">
              <Label>Salary Type</Label>
              <Select
                value={formData.salary_type}
                onValueChange={(v) => setFormData({ ...formData, salary_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SALARY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fixed Salary (₹)</Label>
                <Input
                  type="number"
                  value={formData.fixed_salary}
                  onChange={(e) => setFormData({ ...formData, fixed_salary: parseFloat(e.target.value) || 0 })}
                  disabled={formData.salary_type === 'commission'}
                />
              </div>
              <div className="space-y-2">
                <Label>PT Share (%)</Label>
                <Input
                  type="number"
                  value={formData.pt_share_percentage}
                  onChange={(e) => setFormData({ ...formData, pt_share_percentage: parseFloat(e.target.value) || 50 })}
                />
              </div>
            </div>
          </div>

          {/* Government ID */}
          <div className="space-y-2">
            <Label>Government ID</Label>
            <Input
              value={formData.government_id}
              onChange={(e) => setFormData({ ...formData, government_id: e.target.value })}
              placeholder="Aadhar/PAN number"
            />
          </div>

          {/* Hardware & Biometrics */}
          <StaffBiometricsTab
            staffId={trainer.id}
            staffType="trainer"
            staffName={trainer.profile_name || 'Trainer'}
            branchId={trainer.branch_id}
            biometricPhotoUrl={trainer.biometric_photo_url}
            biometricEnrolled={trainer.biometric_enrolled}
          />

          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateTrainer.isPending}>
              {updateTrainer.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
