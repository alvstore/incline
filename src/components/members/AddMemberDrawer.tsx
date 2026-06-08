import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Gift, IdCard } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranchContext } from '@/contexts/BranchContext';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { MemberAvatarUpload } from './MemberAvatarUpload';
import {
  DIETARY_PREFERENCES,
  CUISINE_PREFERENCES,
  FITNESS_LEVELS,
  ACTIVITY_LEVELS,
  EQUIPMENT_OPTIONS,
} from '@/types/fitnessPlan';
import { Checkbox } from '@/components/ui/checkbox';
import { DefaultPasswordCard, DEFAULT_TEMP_PASSWORD } from '@/components/auth/TempPasswordField';

interface AddMemberDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
}

export function AddMemberDrawer({ open, onOpenChange, branchId }: AddMemberDrawerProps) {
  const { user } = useAuth();
  const { branchFilter, branches } = useBranchContext();
  const [avatarUrl, setAvatarUrl] = useState('');
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    gender: '',
    dateOfBirth: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    fitnessGoals: '',
    healthConditions: '',
    source: 'walk-in',
    referralCode: '',
    governmentIdType: '',
    governmentIdNumber: '',
    dietaryPreference: '',
    cuisinePreference: '',
    allergies: '',
    fitnessLevel: '',
    activityLevel: '',
    injuriesLimitations: '',
  });
  const [equipmentAvailability, setEquipmentAvailability] = useState<string[]>([]);
  const [referrerInfo, setReferrerInfo] = useState<{ id: string; name: string } | null>(null);
  
  const queryClient = useQueryClient();

  // Validate referral code
  const validateReferralCode = async (code: string) => {
    if (!code.trim()) {
      setReferrerInfo(null);
      return;
    }
    
    // Look up member by member_code
    const { data: member, error } = await supabase
      .from('members')
      .select('id, member_code, user_id, profiles:user_id(full_name)')
      .eq('member_code', code.toUpperCase())
      .single();
    
    if (error || !member) {
      setReferrerInfo(null);
      toast.error('Invalid referral code');
      return;
    }
    
    setReferrerInfo({
      id: member.id,
      name: (member as any).profiles?.full_name || member.member_code,
    });
    toast.success(`Referrer found: ${(member as any).profiles?.full_name || member.member_code}`);
  };

  const createMember = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Create member via dedicated edge function (handles user, profile, role, and member record)
      const { data: result, error: fnError } = await supabase.functions.invoke('create-member-user', {
        body: {
          email: data.email,
          fullName: data.fullName,
          phone: data.phone,
          branchId: branchId,
          gender: data.gender || null,
          dateOfBirth: data.dateOfBirth || null,
          address: data.address || null,
          emergencyContactName: data.emergencyContactName || null,
          emergencyContactPhone: data.emergencyContactPhone || null,
          source: data.source,
          fitnessGoals: data.fitnessGoals || null,
          healthConditions: data.healthConditions || null,
          referredBy: referrerInfo?.id || null,
          createdBy: user?.id || null,
          avatarUrl: avatarUrl || null,
          governmentIdType: data.governmentIdType || null,
          governmentIdNumber: data.governmentIdNumber || null,
          dietaryPreference: data.dietaryPreference || null,
          cuisinePreference: data.cuisinePreference || null,
          allergies: data.allergies
            ? data.allergies.split(',').map(s => s.trim()).filter(Boolean)
            : [],
          fitnessLevel: data.fitnessLevel || null,
          activityLevel: data.activityLevel || null,
          equipmentAvailability,
          injuriesLimitations: data.injuriesLimitations || null,
          password: undefined,
        },
      });

      if (fnError) throw fnError;
      if (result.error) {
        if (result.code === 'email_exists') {
          throw new Error('A member with this email already exists');
        }
        throw new Error(result.error);
      }

      const memberId = result.memberId;

      // Referral row is created server-side inside `create-member-user`
      // (transactional with member creation). Do not insert a duplicate here.

      return { id: memberId, member_code: result.memberCode, tempPassword: result.tempPassword as string | null };
    },
    onSuccess: (res) => {
      toast.success(`Member added. Default password: ${DEFAULT_TEMP_PASSWORD}`, {
        duration: 12000,
        action: {
          label: 'Copy',
          onClick: () => navigator.clipboard.writeText(DEFAULT_TEMP_PASSWORD),
        },
      });
      invalidateMembersData(queryClient);
      if (branchFilter && branchFilter !== branchId) {
        const targetBranch = branches.find((b) => b.id === branchId);
        const branchName = targetBranch?.name || 'another branch';
        toast.info(`Member added to ${branchName} — switch to that branch to see them`);
      }
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to add member');
    },
  });

  const resetForm = () => {
    setAvatarUrl('');
    setFormData({
      fullName: '',
      email: '',
      phone: '',
      gender: '',
      dateOfBirth: '',
      address: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      fitnessGoals: '',
      healthConditions: '',
      source: 'walk-in',
      referralCode: '',
      governmentIdType: '',
      governmentIdNumber: '',
      dietaryPreference: '',
      cuisinePreference: '',
      allergies: '',
      fitnessLevel: '',
      activityLevel: '',
      injuriesLimitations: '',
    });
    setEquipmentAvailability([]);
    setReferrerInfo(null);
    
  };

  const toggleEquipment = (value: string) => {
    setEquipmentAvailability(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName || !formData.email || !formData.phone) {
      toast.error('Please fill in required fields');
      return;
    }
    if (!branchId || branchId === 'all') {
      toast.error('Please select a specific branch');
      return;
    }
    createMember.mutate(formData);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add New Member
          </SheetTitle>
        </SheetHeader>
        
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* Avatar Upload */}
          <div className="flex justify-center pb-2">
            <MemberAvatarUpload
              avatarUrl={avatarUrl}
              name={formData.fullName || 'New Member'}
              onAvatarChange={setAvatarUrl}
              size="lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone *</Label>
              <PhoneInput
                id="phone"
                value={formData.phone}
                onChange={(value) => setFormData({ ...formData, phone: value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select value={formData.gender} onValueChange={(v) => setFormData({ ...formData, gender: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">Date of Birth</Label>
              <Input
                id="dateOfBirth"
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source">Source</Label>
              <Select value={formData.source} onValueChange={(v) => setFormData({ ...formData, source: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="walk-in">Walk-in</SelectItem>
                  <SelectItem value="website">Website</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="social-media">Social Media</SelectItem>
                  <SelectItem value="advertisement">Advertisement</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Referral Code */}
          <div className="space-y-2">
            <Label htmlFor="referralCode" className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              Referral Code (Member Code)
            </Label>
            <div className="flex gap-2">
              <Input
                id="referralCode"
                placeholder="Enter referrer's member code"
                value={formData.referralCode}
                onChange={(e) => setFormData({ ...formData, referralCode: e.target.value.toUpperCase() })}
              />
              <Button 
                type="button" 
                variant="outline"
                onClick={() => validateReferralCode(formData.referralCode)}
                disabled={!formData.referralCode}
              >
                Verify
              </Button>
            </div>
            {referrerInfo && (
              <p className="text-sm text-success flex items-center gap-1">
                <Gift className="h-3 w-3" />
                Referred by: {referrerInfo.name}
              </p>
            )}
          </div>

          {/* Government ID Section */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <IdCard className="h-4 w-4 text-primary" />
              Government ID (for verification)
            </Label>
            <div className="grid grid-cols-2 gap-4">
              <Select 
                value={formData.governmentIdType} 
                onValueChange={(v) => setFormData({ ...formData, governmentIdType: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="ID Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aadhaar">Aadhaar Card</SelectItem>
                  <SelectItem value="pan">PAN Card</SelectItem>
                  <SelectItem value="passport">Passport</SelectItem>
                  <SelectItem value="driving_license">Driving License</SelectItem>
                  <SelectItem value="voter_id">Voter ID</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="ID Number"
                value={formData.governmentIdNumber}
                onChange={(e) => setFormData({ ...formData, governmentIdNumber: e.target.value })}
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
              <Label htmlFor="emergencyContactName">Emergency Contact</Label>
              <Input
                id="emergencyContactName"
                placeholder="Name"
                value={formData.emergencyContactName}
                onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergencyContactPhone">Emergency Phone</Label>
              <PhoneInput
                id="emergencyContactPhone"
                value={formData.emergencyContactPhone}
                onChange={(value) => setFormData({ ...formData, emergencyContactPhone: value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fitnessGoals">Fitness Goal</Label>
            <Select value={formData.fitnessGoals} onValueChange={(v) => setFormData({ ...formData, fitnessGoals: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select fitness goal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Weight Loss">Weight Loss</SelectItem>
                <SelectItem value="Muscle Gain">Muscle Gain</SelectItem>
                <SelectItem value="Endurance">Endurance</SelectItem>
                <SelectItem value="General Fitness">General Fitness</SelectItem>
                <SelectItem value="Flexibility">Flexibility</SelectItem>
                <SelectItem value="Body Recomposition">Body Recomposition</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="healthConditions">Health Conditions</Label>
            <Textarea
              id="healthConditions"
              value={formData.healthConditions}
              onChange={(e) => setFormData({ ...formData, healthConditions: e.target.value })}
              placeholder="Any medical conditions..."
              rows={2}
            />
          </div>

          <DefaultPasswordCard />

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={createMember.isPending}>
              {createMember.isPending ? 'Adding...' : 'Add Member'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
