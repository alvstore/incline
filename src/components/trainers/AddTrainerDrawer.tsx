import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { X, UserPlus, Link } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCreateTrainer } from '@/hooks/useTrainers';
import { StaffAvatarUpload } from '@/components/common/StaffAvatarUpload';
import { DefaultPasswordCard, DEFAULT_TEMP_PASSWORD } from '@/components/auth/TempPasswordField';
import {
  SPECIALIZATION_OPTIONS,
  TRAINER_SALARY_TYPES,
  GOVERNMENT_ID_TYPES,
} from '@/constants/trainerConstants';

interface AddTrainerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
}

type FormState = {
  // Auth-bound (new user only)
  email: string;
  // Profile
  full_name: string;
  phone: string;
  gender: string;
  date_of_birth: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  // Trainer
  bio: string;
  specializations: string[];
  certifications: string[];
  max_clients: number;
  salary_type: string;
  hourly_rate: number;
  fixed_salary: number;
  pt_share_percentage: number;
  government_id_type: string;
  government_id_number: string;
  // Link mode
  user_id: string;
};

const emptyForm = (): FormState => ({
  email: '',
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
  bio: '',
  specializations: [],
  certifications: [],
  max_clients: 10,
  salary_type: 'fixed',
  hourly_rate: 0,
  fixed_salary: 0,
  pt_share_percentage: 50,
  government_id_type: '',
  government_id_number: '',
  user_id: '',
});

export function AddTrainerDrawer({ open, onOpenChange, branchId }: AddTrainerDrawerProps) {
  const [availableUsers, setAvailableUsers] = useState<{ id: string; email: string; full_name: string | null }[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [activeTab, setActiveTab] = useState<'new' | 'link'>('new');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [newCertification, setNewCertification] = useState('');
  const createTrainer = useCreateTrainer();
  const queryClient = useQueryClient();

  const [newUserForm, setNewUserForm] = useState<FormState>(emptyForm());
  const [linkForm, setLinkForm] = useState<FormState>(emptyForm());

  const isLink = activeTab === 'link';
  const form = isLink ? linkForm : newUserForm;
  const setForm = isLink ? setLinkForm : setNewUserForm;

  const loadAvailableUsers = async () => {
    if (!branchId) return;
    setLoadingUsers(true);
    try {
      const { data: existingTrainers } = await supabase.from('trainers').select('user_id').eq('branch_id', branchId);
      const existingTrainerIds = (existingTrainers || []).map((t) => t.user_id);
      const { data: existingMembers } = await supabase.from('members').select('user_id').not('user_id', 'is', null);
      const existingMemberIds = (existingMembers || []).map((m) => m.user_id);
      const { data: users } = await supabase.from('profiles').select('id, email, full_name');
      const filtered = (users || []).filter((u) => !existingTrainerIds.includes(u.id) && !existingMemberIds.includes(u.id));
      setAvailableUsers(filtered);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (open) loadAvailableUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId]);

  const resetForms = () => {
    setAvatarUrl('');
    setNewUserForm(emptyForm());
    setLinkForm(emptyForm());
    setNewCertification('');
  };

  const toggleSpec = (spec: string) => {
    setForm({
      ...form,
      specializations: form.specializations.includes(spec)
        ? form.specializations.filter((s) => s !== spec)
        : [...form.specializations, spec],
    });
  };

  const addCertification = () => {
    const v = newCertification.trim();
    if (!v || form.certifications.includes(v)) return;
    setForm({ ...form, certifications: [...form.certifications, v] });
    setNewCertification('');
  };

  const removeCertification = (c: string) => {
    setForm({ ...form, certifications: form.certifications.filter((x) => x !== c) });
  };

  const buildProfileUpdate = (f: FormState) => ({
    full_name: f.full_name || null,
    phone: f.phone || null,
    gender: (f.gender || null) as 'male' | 'female' | 'other' | null,
    date_of_birth: f.date_of_birth || null,
    address: f.address || null,
    city: f.city || null,
    state: f.state || null,
    postal_code: f.postal_code || null,
    emergency_contact_name: f.emergency_contact_name || null,
    emergency_contact_phone: f.emergency_contact_phone || null,
  });

  const handleLinkExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkForm.user_id || !branchId) {
      toast.error('Please select a user');
      return;
    }
    setIsSubmitting(true);
    try {
      await createTrainer.mutateAsync({
        branch_id: branchId,
        user_id: linkForm.user_id,
        specializations: linkForm.specializations.length ? linkForm.specializations : null,
        certifications: linkForm.certifications.length ? linkForm.certifications : null,
        bio: linkForm.bio || null,
        max_clients: linkForm.max_clients,
        hourly_rate: linkForm.hourly_rate || null,
        salary_type: linkForm.salary_type,
        fixed_salary: linkForm.fixed_salary || null,
        pt_share_percentage: linkForm.pt_share_percentage,
        government_id_type: linkForm.government_id_type || null,
        government_id_number: linkForm.government_id_number || null,
      });

      // Update profile with personal details
      await supabase.from('profiles').update(buildProfileUpdate(linkForm)).eq('id', linkForm.user_id);

      // Assign trainer role + branch (best-effort, ignore duplicates)
      await supabase.from('user_roles').insert({ user_id: linkForm.user_id, role: 'trainer' });
      await supabase.from('staff_branches').insert({ user_id: linkForm.user_id, branch_id: branchId });

      toast.success('Trainer profile created');
      await queryClient.invalidateQueries({ queryKey: ['trainers'] });
      onOpenChange(false);
      resetForms();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create trainer profile';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.email || !branchId) {
      toast.error('Please fill in all required fields');
      return;
    }
    setIsSubmitting(true);
    try {
      const { data: userData, error: createError } = await supabase.functions.invoke('create-staff-user', {
        body: {
          email: newUserForm.email,
          fullName: newUserForm.full_name,
          phone: newUserForm.phone,
          role: 'trainer',
          branchId,
          gender: newUserForm.gender,
          dateOfBirth: newUserForm.date_of_birth,
          address: newUserForm.address,
          city: newUserForm.city,
          state: newUserForm.state,
          postalCode: newUserForm.postal_code,
          emergencyContactName: newUserForm.emergency_contact_name,
          emergencyContactPhone: newUserForm.emergency_contact_phone,
          salaryType: newUserForm.salary_type,
          fixedSalary: newUserForm.fixed_salary || null,
          hourlyRate: newUserForm.hourly_rate || null,
          ptSharePercentage: newUserForm.pt_share_percentage,
          maxClients: newUserForm.max_clients,
          governmentIdType: newUserForm.government_id_type || null,
          governmentIdNumber: newUserForm.government_id_number || null,
          specializations: newUserForm.specializations,
          certifications: newUserForm.certifications,
          bio: newUserForm.bio,
        },
      });
      if (createError) throw createError;
      if (userData?.error) throw new Error(userData.error);

      // Avatar (post-create, since we need user_id)
      if (avatarUrl && userData?.userId) {
        await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', userData.userId);
      }

      toast.success(`Trainer created. Default password: ${DEFAULT_TEMP_PASSWORD}`, {
        duration: 12000,
        action: { label: 'Copy', onClick: () => navigator.clipboard.writeText(DEFAULT_TEMP_PASSWORD) },
      });
      await queryClient.invalidateQueries({ queryKey: ['trainers'] });
      onOpenChange(false);
      resetForms();
    } catch (error: unknown) {
      console.error('Error creating trainer:', error);
      const msg = error instanceof Error ? error.message : 'Failed to create trainer';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderPersonalDetails = (f: FormState, setF: (v: FormState) => void, includeNameEmail: boolean) => (
    <div className="space-y-3 p-4 border rounded-lg">
      <h4 className="font-medium text-sm">Personal Details</h4>
      <div className="grid grid-cols-2 gap-3">
        {includeNameEmail && (
          <>
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} placeholder="John Doe" required />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <PhoneInput value={f.phone} onChange={(value) => setF({ ...f, phone: value })} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Email *</Label>
              <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="trainer@gym.com" required />
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label>Gender</Label>
          <Select
            value={f.gender || 'unspecified'}
            onValueChange={(v) => setF({ ...f, gender: v === 'unspecified' ? '' : v })}
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
          <Input type="date" value={f.date_of_birth} onChange={(e) => setF({ ...f, date_of_birth: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Postal Code</Label>
          <Input value={f.postal_code} onChange={(e) => setF({ ...f, postal_code: e.target.value })} />
        </div>
        <div className="space-y-2 col-span-2">
          <Label>Address</Label>
          <Textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>City</Label>
          <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>State</Label>
          <Input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Emergency Contact Name</Label>
          <Input value={f.emergency_contact_name} onChange={(e) => setF({ ...f, emergency_contact_name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Emergency Contact Phone</Label>
          <Input value={f.emergency_contact_phone} onChange={(e) => setF({ ...f, emergency_contact_phone: e.target.value })} />
        </div>
      </div>
    </div>
  );

  const renderSpecializations = (f: FormState) => (
    <div className="space-y-2">
      <Label>Specializations</Label>
      <div className="flex flex-wrap gap-2">
        {SPECIALIZATION_OPTIONS.map((spec) => (
          <Badge
            key={spec}
            variant={f.specializations.includes(spec) ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => toggleSpec(spec)}
          >
            {spec}
          </Badge>
        ))}
      </div>
    </div>
  );

  const renderCertifications = (f: FormState) => (
    <div className="space-y-2">
      <Label>Certifications</Label>
      <div className="flex gap-2">
        <Input
          value={newCertification}
          onChange={(e) => setNewCertification(e.target.value)}
          placeholder="Add certification..."
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCertification())}
        />
        <Button type="button" variant="outline" onClick={addCertification}>Add</Button>
      </div>
      {f.certifications.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {f.certifications.map((cert) => (
            <Badge key={cert} variant="secondary" className="gap-1">
              {cert}
              <X className="h-3 w-3 cursor-pointer hover:text-destructive" onClick={() => removeCertification(cert)} />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );

  const renderCompensation = (f: FormState, setF: (v: FormState) => void) => (
    <div className="space-y-4 p-4 border rounded-lg">
      <h4 className="font-medium">Compensation</h4>
      <div className="space-y-2">
        <Label>Salary Type</Label>
        <Select value={f.salary_type} onValueChange={(v) => setF({ ...f, salary_type: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRAINER_SALARY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Max Clients</Label>
          <Input type="number" value={f.max_clients}
            onChange={(e) => setF({ ...f, max_clients: parseInt(e.target.value) || 10 })} />
        </div>
        <div className="space-y-2">
          <Label>Hourly Rate (₹)</Label>
          <Input type="number" value={f.hourly_rate}
            onChange={(e) => setF({ ...f, hourly_rate: parseFloat(e.target.value) || 0 })} />
        </div>
        <div className="space-y-2">
          <Label>Fixed Salary (₹)</Label>
          <Input type="number" value={f.fixed_salary} disabled={f.salary_type === 'commission'}
            onChange={(e) => setF({ ...f, fixed_salary: parseFloat(e.target.value) || 0 })} />
        </div>
        <div className="space-y-2">
          <Label>PT Share (%)</Label>
          <Input type="number" min={0} max={100} value={f.pt_share_percentage}
            onChange={(e) => setF({ ...f, pt_share_percentage: parseFloat(e.target.value) || 50 })} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Trainer gets {f.pt_share_percentage}%, Owner gets {100 - f.pt_share_percentage}% (before GST)
      </p>
    </div>
  );

  const renderGovernmentId = (f: FormState, setF: (v: FormState) => void) => (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>Government ID Type</Label>
        <Select value={f.government_id_type} onValueChange={(v) => setF({ ...f, government_id_type: v })}>
          <SelectTrigger><SelectValue placeholder="Select ID type" /></SelectTrigger>
          <SelectContent>
            {GOVERNMENT_ID_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>ID Number</Label>
        <Input value={f.government_id_number}
          onChange={(e) => setF({ ...f, government_id_number: e.target.value })} placeholder="Enter ID number" />
      </div>
    </div>
  );

  const renderBio = (f: FormState, setF: (v: FormState) => void) => (
    <div className="space-y-2">
      <Label>Bio</Label>
      <Textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })}
        placeholder="Trainer bio and experience..." rows={3} />
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Trainer Profile</SheetTitle>
          <SheetDescription>Create a new trainer or link an existing user profile</SheetDescription>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'new' | 'link')} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="new" className="gap-2"><UserPlus className="h-4 w-4" />Create New User</TabsTrigger>
            <TabsTrigger value="link" className="gap-2"><Link className="h-4 w-4" />Link Existing</TabsTrigger>
          </TabsList>

          {/* Create New */}
          <TabsContent value="new">
            <form onSubmit={handleCreateNew} className="space-y-4 py-4">
              <div className="p-3 rounded-lg bg-info/10 border border-info/30 text-sm">
                <p className="text-info font-medium">Create New User</p>
                <p className="text-muted-foreground">This will create a new user account and trainer profile.</p>
              </div>

              <div className="flex justify-center pb-2">
                <StaffAvatarUpload
                  avatarUrl={avatarUrl}
                  name={newUserForm.full_name || 'New Trainer'}
                  onAvatarChange={setAvatarUrl}
                  size="lg"
                />
              </div>

              {renderPersonalDetails(newUserForm, setNewUserForm, true)}
              <DefaultPasswordCard />
              {renderGovernmentId(newUserForm, setNewUserForm)}
              {renderSpecializations(newUserForm)}
              {renderCertifications(newUserForm)}
              {renderCompensation(newUserForm, setNewUserForm)}
              {renderBio(newUserForm, setNewUserForm)}

              <SheetFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting || createTrainer.isPending}>
                  {isSubmitting || createTrainer.isPending ? 'Creating...' : 'Create Trainer'}
                </Button>
              </SheetFooter>
            </form>
          </TabsContent>

          {/* Link Existing */}
          <TabsContent value="link">
            <form onSubmit={handleLinkExisting} className="space-y-4 py-4">
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
                <p className="text-warning font-medium">Link Existing Profile</p>
                <p className="text-muted-foreground">Only profiles that are NOT linked to members are shown.</p>
              </div>

              <div className="space-y-2">
                <Label>User *</Label>
                <Select value={linkForm.user_id} onValueChange={(v) => setLinkForm({ ...linkForm, user_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingUsers ? 'Loading...' : 'Select user'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.length === 0 ? (
                      <div className="p-2 text-sm text-muted-foreground text-center">No available users found</div>
                    ) : (
                      availableUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.full_name || user.email}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {renderPersonalDetails(linkForm, setLinkForm, false)}
              {renderGovernmentId(linkForm, setLinkForm)}
              {renderSpecializations(linkForm)}
              {renderCertifications(linkForm)}
              {renderCompensation(linkForm, setLinkForm)}
              {renderBio(linkForm, setLinkForm)}

              <SheetFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting || createTrainer.isPending || availableUsers.length === 0}>
                  {isSubmitting || createTrainer.isPending ? 'Creating...' : 'Add Trainer'}
                </Button>
              </SheetFooter>
            </form>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
