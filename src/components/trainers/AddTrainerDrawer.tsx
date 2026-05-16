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
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCreateTrainer } from '@/hooks/useTrainers';
import { UserPlus, Link } from 'lucide-react';
import { StaffAvatarUpload } from '@/components/common/StaffAvatarUpload';
import { DefaultPasswordCard, DEFAULT_TEMP_PASSWORD } from '@/components/auth/TempPasswordField';

const SALARY_TYPES = [
  { value: 'hourly', label: 'Hourly Rate' },
  { value: 'fixed', label: 'Fixed Salary' },
];

const GOVERNMENT_ID_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar Card' },
  { value: 'pan', label: 'PAN Card' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'passport', label: 'Passport' },
];

interface AddTrainerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
}

export function AddTrainerDrawer({ open, onOpenChange, branchId }: AddTrainerDrawerProps) {
  const [availableUsers, setAvailableUsers] = useState<{ id: string; email: string; full_name: string | null }[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [activeTab, setActiveTab] = useState<'new' | 'link'>('new');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const createTrainer = useCreateTrainer();
  const queryClient = useQueryClient();

  // Form data for linking existing user
  const [linkFormData, setLinkFormData] = useState({
    user_id: '',
    specializations: '',
    certifications: '',
    bio: '',
    salary_type: 'hourly',
    hourly_rate: 0,
    fixed_salary: 0,
    pt_share_percentage: 40,
    government_id_type: '',
    government_id_number: '',
  });

  // Form data for creating new user
  const [newUserFormData, setNewUserFormData] = useState({
    email: '',
    full_name: '',
    phone: '',
    specializations: '',
    certifications: '',
    bio: '',
    salary_type: 'hourly',
    hourly_rate: 0,
    fixed_salary: 0,
    pt_share_percentage: 40,
    government_id_type: '',
    government_id_number: '',
  });

  const loadAvailableUsers = async () => {
    if (!branchId) return;
    setLoadingUsers(true);
    try {
      // Get existing trainer user IDs
      const { data: existingTrainers } = await supabase
        .from('trainers')
        .select('user_id')
        .eq('branch_id', branchId);

      const existingTrainerIds = (existingTrainers || []).map((t) => t.user_id);

      // Get member user IDs (trainers should not be members)
      const { data: existingMembers } = await supabase
        .from('members')
        .select('user_id')
        .not('user_id', 'is', null);
      
      const existingMemberIds = (existingMembers || []).map((m) => m.user_id);

      // Get all profiles
      const { data: users } = await supabase
        .from('profiles')
        .select('id, email, full_name');

      // Filter out users who are already trainers or members
      const filtered = (users || []).filter((u) => 
        !existingTrainerIds.includes(u.id) && 
        !existingMemberIds.includes(u.id)
      );
      setAvailableUsers(filtered);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadAvailableUsers();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId]);

  const handleLinkExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkFormData.user_id || !branchId) {
      toast.error('Please select a user');
      return;
    }

    try {
      await createTrainer.mutateAsync({
        branch_id: branchId,
        user_id: linkFormData.user_id,
        specializations: linkFormData.specializations
          ? linkFormData.specializations.split(',').map((s) => s.trim())
          : null,
        certifications: linkFormData.certifications
          ? linkFormData.certifications.split(',').map((s) => s.trim())
          : null,
        bio: linkFormData.bio || null,
        hourly_rate: linkFormData.salary_type === 'hourly' ? linkFormData.hourly_rate : null,
        salary_type: linkFormData.salary_type,
        fixed_salary: linkFormData.salary_type === 'fixed' ? linkFormData.fixed_salary : null,
        pt_share_percentage: linkFormData.pt_share_percentage,
        government_id_type: linkFormData.government_id_type || null,
        government_id_number: linkFormData.government_id_number || null,
      });

      // Assign trainer role
      await supabase.from('user_roles').insert({
        user_id: linkFormData.user_id,
        role: 'trainer',
      });

      // Add to staff_branches
      await supabase.from('staff_branches').insert({
        user_id: linkFormData.user_id,
        branch_id: branchId,
      });

      toast.success('Trainer profile created');
      await queryClient.invalidateQueries({ queryKey: ['trainers'] });
      onOpenChange(false);
      resetForms();
    } catch (error) {
      toast.error('Failed to create trainer profile');
    }
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserFormData.email || !branchId) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    try {
      // Create user via new edge function that handles trainer creation
      const { data: userData, error: createError } = await supabase.functions.invoke('create-staff-user', {
        body: {
          email: newUserFormData.email,
          fullName: newUserFormData.full_name,
          phone: newUserFormData.phone,
          role: 'trainer',
          branchId: branchId,
          salaryType: newUserFormData.salary_type,
          fixedSalary: newUserFormData.salary_type === 'fixed' ? newUserFormData.fixed_salary : null,
          hourlyRate: newUserFormData.salary_type === 'hourly' ? newUserFormData.hourly_rate : null,
          ptSharePercentage: newUserFormData.pt_share_percentage,
          governmentIdType: newUserFormData.government_id_type || null,
          governmentIdNumber: newUserFormData.government_id_number || null,
          specializations: newUserFormData.specializations
            ? newUserFormData.specializations.split(',').map((s) => s.trim())
            : [],
        },
      });

      if (createError) throw createError;
      if (userData?.error) throw new Error(userData.error);

      toast.success(`Trainer created. Default password: ${DEFAULT_TEMP_PASSWORD}`, {
        duration: 12000,
        action: { label: 'Copy', onClick: () => navigator.clipboard.writeText(DEFAULT_TEMP_PASSWORD) },
      });
      await queryClient.invalidateQueries({ queryKey: ['trainers'] });
      onOpenChange(false);
      resetForms();
    } catch (error: any) {
      console.error('Error creating trainer:', error);
      toast.error(error.message || 'Failed to create trainer');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForms = () => {
    setAvatarUrl('');
    setLinkFormData({
      user_id: '',
      specializations: '',
      certifications: '',
      bio: '',
      salary_type: 'hourly',
      hourly_rate: 0,
      fixed_salary: 0,
      pt_share_percentage: 40,
      government_id_type: '',
      government_id_number: '',
    });
    setNewUserFormData({
      email: '',
      full_name: '',
      phone: '',
      specializations: '',
      certifications: '',
      bio: '',
      salary_type: 'hourly',
      hourly_rate: 0,
      fixed_salary: 0,
      pt_share_percentage: 40,
      government_id_type: '',
      government_id_number: '',
    });
  };

  const renderCompensationFields = (formData: any, setFormData: any) => (
    <>
      <div className="space-y-2">
        <Label>Salary Type</Label>
        <Select
          value={formData.salary_type}
          onValueChange={(value) => setFormData({ ...formData, salary_type: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SALARY_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {formData.salary_type === 'hourly' ? (
        <div className="space-y-2">
          <Label>Hourly Rate (₹)</Label>
          <Input
            type="number"
            value={formData.hourly_rate}
            onChange={(e) => setFormData({ ...formData, hourly_rate: parseFloat(e.target.value) || 0 })}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Fixed Salary (₹/month)</Label>
          <Input
            type="number"
            value={formData.fixed_salary}
            onChange={(e) => setFormData({ ...formData, fixed_salary: parseFloat(e.target.value) || 0 })}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>PT Share Percentage (%)</Label>
        <Input
          type="number"
          min={0}
          max={100}
          value={formData.pt_share_percentage}
          onChange={(e) => setFormData({ ...formData, pt_share_percentage: parseFloat(e.target.value) || 40 })}
        />
        <p className="text-xs text-muted-foreground">
          Trainer gets {formData.pt_share_percentage}%, Owner gets {100 - formData.pt_share_percentage}% (before GST)
        </p>
      </div>
    </>
  );

  const renderGovernmentIdFields = (formData: any, setFormData: any) => (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>Government ID Type</Label>
        <Select
          value={formData.government_id_type}
          onValueChange={(value) => setFormData({ ...formData, government_id_type: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select ID type" />
          </SelectTrigger>
          <SelectContent>
            {GOVERNMENT_ID_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>ID Number</Label>
        <Input
          value={formData.government_id_number}
          onChange={(e) => setFormData({ ...formData, government_id_number: e.target.value })}
          placeholder="Enter ID number"
        />
      </div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Trainer Profile</SheetTitle>
          <SheetDescription>Create a new trainer or link an existing user profile</SheetDescription>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'new' | 'link')} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="new" className="gap-2">
              <UserPlus className="h-4 w-4" />
              Create New User
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-2">
              <Link className="h-4 w-4" />
              Link Existing
            </TabsTrigger>
          </TabsList>

          {/* Create New User Tab */}
          <TabsContent value="new">
            <form onSubmit={handleCreateNew} className="space-y-4 py-4">
              <div className="p-3 rounded-lg bg-info/10 border border-info/30 text-sm">
                <p className="text-info font-medium">Create New User</p>
                <p className="text-muted-foreground">This will create a new user account and trainer profile.</p>
              </div>

              {/* Avatar Upload */}
              <div className="flex justify-center pb-2">
                <StaffAvatarUpload
                  avatarUrl={avatarUrl}
                  name={newUserFormData.full_name || 'New Trainer'}
                  onAvatarChange={setAvatarUrl}
                  size="lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Full Name *</Label>
                  <Input
                    value={newUserFormData.full_name}
                    onChange={(e) => setNewUserFormData({ ...newUserFormData, full_name: e.target.value })}
                    placeholder="John Doe"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <PhoneInput
                    value={newUserFormData.phone}
                    onChange={(value) => setNewUserFormData({ ...newUserFormData, phone: value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={newUserFormData.email}
                  onChange={(e) => setNewUserFormData({ ...newUserFormData, email: e.target.value })}
                  placeholder="trainer@gym.com"
                  required
                />
                <p className="text-xs text-muted-foreground">Trainer will sign in with the default password and change it on first login</p>
              </div>

              <DefaultPasswordCard />


              {renderGovernmentIdFields(newUserFormData, setNewUserFormData)}

              <div className="space-y-2">
                <Label>Specializations</Label>
                <Input
                  value={newUserFormData.specializations}
                  onChange={(e) => setNewUserFormData({ ...newUserFormData, specializations: e.target.value })}
                  placeholder="Yoga, HIIT, Strength (comma-separated)"
                />
              </div>

              <div className="space-y-2">
                <Label>Certifications</Label>
                <Input
                  value={newUserFormData.certifications}
                  onChange={(e) => setNewUserFormData({ ...newUserFormData, certifications: e.target.value })}
                  placeholder="ACE, NASM, CPR (comma-separated)"
                />
              </div>

              {renderCompensationFields(newUserFormData, setNewUserFormData)}

              <div className="space-y-2">
                <Label>Bio</Label>
                <Textarea
                  value={newUserFormData.bio}
                  onChange={(e) => setNewUserFormData({ ...newUserFormData, bio: e.target.value })}
                  placeholder="Trainer bio and experience..."
                  rows={3}
                />
              </div>

              <SheetFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || createTrainer.isPending}>
                  {isSubmitting || createTrainer.isPending ? 'Creating...' : 'Create Trainer'}
                </Button>
              </SheetFooter>
            </form>
          </TabsContent>

          {/* Link Existing User Tab */}
          <TabsContent value="link">
            <form onSubmit={handleLinkExisting} className="space-y-4 py-4">
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
                <p className="text-warning font-medium">Link Existing Profile</p>
                <p className="text-muted-foreground">Only profiles that are NOT linked to members are shown.</p>
              </div>

              <div className="space-y-2">
                <Label>User *</Label>
                <Select
                  value={linkFormData.user_id}
                  onValueChange={(value) => setLinkFormData({ ...linkFormData, user_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingUsers ? 'Loading...' : 'Select user'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.length === 0 ? (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        No available users found
                      </div>
                    ) : (
                      availableUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.full_name || user.email}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {renderGovernmentIdFields(linkFormData, setLinkFormData)}

              <div className="space-y-2">
                <Label>Specializations</Label>
                <Input
                  value={linkFormData.specializations}
                  onChange={(e) => setLinkFormData({ ...linkFormData, specializations: e.target.value })}
                  placeholder="Yoga, HIIT, Strength (comma-separated)"
                />
              </div>

              <div className="space-y-2">
                <Label>Certifications</Label>
                <Input
                  value={linkFormData.certifications}
                  onChange={(e) => setLinkFormData({ ...linkFormData, certifications: e.target.value })}
                  placeholder="ACE, NASM, CPR (comma-separated)"
                />
              </div>

              {renderCompensationFields(linkFormData, setLinkFormData)}

              <div className="space-y-2">
                <Label>Bio</Label>
                <Textarea
                  value={linkFormData.bio}
                  onChange={(e) => setLinkFormData({ ...linkFormData, bio: e.target.value })}
                  placeholder="Trainer bio and experience..."
                  rows={3}
                />
              </div>

              <SheetFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createTrainer.isPending || availableUsers.length === 0}>
                  {createTrainer.isPending ? 'Creating...' : 'Add Trainer'}
                </Button>
              </SheetFooter>
            </form>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
