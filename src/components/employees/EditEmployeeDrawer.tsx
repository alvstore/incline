import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { StaffAvatarUpload } from '@/components/common/StaffAvatarUpload';
import { queueStaffSync } from '@/services/biometricService';
import { DEPARTMENTS, POSITIONS, SALARY_TYPES } from '@/constants/employeeConstants';
import { StaffBiometricsTab } from '@/components/common/StaffBiometricsTab';

interface EditEmployeeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: any;
}

const GOV_ID_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'pan', label: 'PAN' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'voter_id', label: 'Voter ID' },
];

export function EditEmployeeDrawer({ open, onOpenChange, employee }: EditEmployeeDrawerProps) {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');

  const [employmentData, setEmploymentData] = useState({
    department: '',
    position: '',
    salary: 0,
    salary_type: 'monthly',
    bank_name: '',
    bank_account: '',
    tax_id: '',
    weekly_off: 'sunday',
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
    government_id_type: '',
    government_id_number: '',
  });

  const handleAvatarChange = async (url: string) => {
    setAvatarUrl(url);
    if (url && employee?.id) {
      if (employee.user_id) {
        await supabase.from('profiles').update({ avatar_url: url }).eq('id', employee.user_id);
      }
      try {
        await queueStaffSync(employee.id, url, employee.profile?.full_name || 'Employee');
      } catch (err) {
        console.warn('Biometric sync queue failed:', err);
      }
    }
  };

  useEffect(() => {
    if (employee) {
      setAvatarUrl(employee.profile?.avatar_url || employee.biometric_photo_url || '');
      setEmploymentData({
        department: employee.department || '',
        position: employee.position || '',
        salary: employee.salary || 0,
        salary_type: employee.salary_type || 'monthly',
        bank_name: employee.bank_name || '',
        bank_account: employee.bank_account || '',
        tax_id: employee.tax_id || '',
        weekly_off: employee.weekly_off || 'sunday',
        is_active: employee.is_active ?? true,
      });
      setProfileData({
        full_name: employee.profile?.full_name || '',
        phone: employee.profile?.phone || '',
        gender: employee.profile?.gender || '',
        date_of_birth: employee.profile?.date_of_birth || '',
        address: employee.profile?.address || '',
        city: employee.profile?.city || '',
        state: employee.profile?.state || '',
        postal_code: employee.profile?.postal_code || '',
        emergency_contact_name: employee.profile?.emergency_contact_name || '',
        emergency_contact_phone: employee.profile?.emergency_contact_phone || '',
        government_id_type: employee.profile?.government_id_type || '',
        government_id_number: employee.profile?.government_id_number || '',
      });
    }
  }, [employee]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee?.id) return;

    setIsLoading(true);
    try {
      const empUpdate = supabase
        .from('employees')
        .update({
          department: employmentData.department || null,
          position: employmentData.position || null,
          salary: employmentData.salary,
          salary_type: employmentData.salary_type,
          bank_name: employmentData.bank_name || null,
          bank_account: employmentData.bank_account || null,
          tax_id: employmentData.tax_id || null,
          weekly_off: employmentData.weekly_off || null,
          is_active: employmentData.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', employee.id);

      const profileUpdate = employee.user_id
        ? supabase
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
              government_id_type: profileData.government_id_type || null,
              government_id_number: profileData.government_id_number || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', employee.user_id)
        : Promise.resolve({ error: null } as any);

      const [empRes, profRes] = await Promise.all([empUpdate, profileUpdate]);
      if ((empRes as any).error) throw (empRes as any).error;
      if ((profRes as any).error) throw (profRes as any).error;

      queryClient.invalidateQueries({ queryKey: ['hrm-employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['branch-managers'] });
      toast.success('Employee updated successfully');
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update employee');
    } finally {
      setIsLoading(false);
    }
  };

  if (!employee) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Employee</SheetTitle>
          <SheetDescription>
            Update {employee.profile?.full_name || 'employee'}'s personal, employment & biometric details
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="flex justify-center pb-2">
            <StaffAvatarUpload
              avatarUrl={avatarUrl}
              name={employee?.profile?.full_name || 'Employee'}
              onAvatarChange={handleAvatarChange}
              size="lg"
            />
          </div>

          <Tabs defaultValue="personal" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="personal">Personal</TabsTrigger>
              <TabsTrigger value="employment">Employment</TabsTrigger>
              <TabsTrigger value="biometrics">Biometrics</TabsTrigger>
            </TabsList>

            {/* PERSONAL TAB */}
            <TabsContent value="personal" className="space-y-4 mt-4">
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
                Personal details are shared across Employee, Trainer, HRM and Contracts. Editing here updates the master profile everywhere.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2">
                  <Label>Full Name</Label>
                  <Input
                    value={profileData.full_name}
                    onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <PhoneInput
                    value={profileData.phone}
                    onChange={(value) => setProfileData({ ...profileData, phone: value })}
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
              </div>

              <div className="space-y-3 p-4 border rounded-lg">
                <h4 className="font-medium text-sm">Government ID</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>ID Type</Label>
                    <Select
                      value={profileData.government_id_type || 'none'}
                      onValueChange={(v) => setProfileData({ ...profileData, government_id_type: v === 'none' ? '' : v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {GOV_ID_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>ID Number</Label>
                    <Input
                      value={profileData.government_id_number}
                      onChange={(e) => setProfileData({ ...profileData, government_id_number: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 p-4 border rounded-lg">
                <h4 className="font-medium text-sm">Emergency Contact</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={profileData.emergency_contact_name}
                      onChange={(e) => setProfileData({ ...profileData, emergency_contact_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <PhoneInput
                      value={profileData.emergency_contact_phone}
                      onChange={(value) => setProfileData({ ...profileData, emergency_contact_phone: value })}
                    />

                  </div>
                </div>
              </div>
            </TabsContent>

            {/* EMPLOYMENT TAB */}
            <TabsContent value="employment" className="space-y-4 mt-4">
              {employee.branch?.name && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Assigned Branch</Label>
                  <div className="p-3 border rounded-lg bg-muted/30 font-medium text-sm">
                    {employee.branch?.name}
                  </div>
                </div>
              )}

              {employee.employee_code && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Employee Code</Label>
                  <div className="p-3 border rounded-lg bg-muted/30 font-medium text-sm">
                    {employee.employee_code}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                <div>
                  <Label className="font-medium">Active Status</Label>
                  <p className="text-xs text-muted-foreground">Inactive employees are not shown in reports</p>
                </div>
                <Switch
                  checked={employmentData.is_active}
                  onCheckedChange={(v) => setEmploymentData({ ...employmentData, is_active: v })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Select
                    value={employmentData.department}
                    onValueChange={(v) => setEmploymentData({ ...employmentData, department: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map((dept) => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Position</Label>
                  <Select
                    value={employmentData.position || 'none'}
                    onValueChange={(v) => setEmploymentData({ ...employmentData, position: v === 'none' ? '' : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select position" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {POSITIONS.map((pos) => (
                        <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4 p-4 border rounded-lg">
                <h4 className="font-medium">Compensation</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Salary Type</Label>
                    <Select
                      value={employmentData.salary_type}
                      onValueChange={(v) => setEmploymentData({ ...employmentData, salary_type: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SALARY_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Salary (₹)</Label>
                    <Input
                      type="number"
                      value={employmentData.salary}
                      onChange={(e) => setEmploymentData({ ...employmentData, salary: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  For per-session commission %, open the contract drawer or the Trainer profile.
                </p>
              </div>

              <div className="space-y-4 p-4 border rounded-lg">
                <h4 className="font-medium">Bank Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Bank Name</Label>
                    <Input
                      value={employmentData.bank_name}
                      onChange={(e) => setEmploymentData({ ...employmentData, bank_name: e.target.value })}
                      placeholder="e.g., HDFC Bank"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Account Number</Label>
                    <Input
                      value={employmentData.bank_account}
                      onChange={(e) => setEmploymentData({ ...employmentData, bank_account: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>PAN / Tax ID</Label>
                  <Input
                    value={employmentData.tax_id}
                    onChange={(e) => setEmploymentData({ ...employmentData, tax_id: e.target.value })}
                    placeholder="PAN number"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Weekly Off</Label>
                <Select
                  value={employmentData.weekly_off}
                  onValueChange={(v) => setEmploymentData({ ...employmentData, weekly_off: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map((d) => (
                      <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* BIOMETRICS TAB */}
            <TabsContent value="biometrics" className="mt-4">
              <StaffBiometricsTab
                staffId={employee.id}
                staffType="employee"
                staffName={employee.profile?.full_name || 'Employee'}
                branchId={employee.branch_id}
                biometricPhotoUrl={employee.biometric_photo_url}
                biometricEnrolled={employee.biometric_enrolled}
              />
            </TabsContent>
          </Tabs>

          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
