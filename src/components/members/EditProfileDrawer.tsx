import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, User, Phone, Mail, AlertCircle, Camera, Target, Activity } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DIETARY_PREFERENCES,
  CUISINE_PREFERENCES,
  FITNESS_LEVELS,
  ACTIVITY_LEVELS,
  EQUIPMENT_OPTIONS,
} from '@/types/fitnessPlan';

interface EditProfileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: any;
  profile: any;
}

export function EditProfileDrawer({ open, onOpenChange, member, profile }: EditProfileDrawerProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    email: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    fitness_goals: '',
    gstin: '',
    dietary_preference: '',
    cuisine_preference: '',
    allergies: '',
    fitness_level: '',
    activity_level: '',
    injuries_limitations: '',
  });
  const [equipmentAvailability, setEquipmentAvailability] = useState<string[]>([]);

  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        phone: profile.phone || '',
        email: profile.email || '',
        emergency_contact_name: profile.emergency_contact_name || '',
        emergency_contact_phone: profile.emergency_contact_phone || '',
        fitness_goals: member?.fitness_goals || '',
        gstin: member?.gstin || '',
        dietary_preference: member?.dietary_preference || '',
        cuisine_preference: member?.cuisine_preference || '',
        allergies: Array.isArray(member?.allergies) ? member.allergies.join(', ') : '',
        fitness_level: member?.fitness_level || '',
        activity_level: member?.activity_level || '',
        injuries_limitations: member?.injuries_limitations || '',
      });
      setEquipmentAvailability(Array.isArray(member?.equipment_availability) ? member.equipment_availability : []);
      setAvatarUrl(profile.avatar_url || null);
    }
  }, [profile, member]);

  const toggleEquipment = (value: string) => {
    setEquipmentAvailability(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !member?.id) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const ownerKey = member.user_id || member.id;
      const fileName = `${ownerKey}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('member-photos')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('member-photos')
        .getPublicUrl(filePath);

      setAvatarUrl(publicUrl);
      toast.success('Avatar uploaded successfully');
    } catch (error: any) {
      toast.error('Failed to upload avatar');
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member?.user_id && !member?.lead_id) {
      toast.error('Cannot edit profile: Member has no linked user account or lead');
      return;
    }

    setIsSubmitting(true);
    try {
      if (member?.user_id) {
        // Member has completed signup — update the profiles row
        const { error } = await supabase
          .from('profiles')
          .update({
            full_name: formData.full_name,
            phone: formData.phone,
            email: formData.email,
            emergency_contact_name: formData.emergency_contact_name,
            emergency_contact_phone: formData.emergency_contact_phone,
            avatar_url: avatarUrl
          })
          .eq('id', member.user_id);

        if (error) throw error;
      } else if (member?.lead_id) {
        // Pre-signup member (converted from lead) — write PII back to the lead row.
        // Emergency contact fields don't exist on leads, so skip them; they'll be
        // editable once the member completes signup and a profile row exists.
        const { error } = await supabase
          .from('leads')
          .update({
            full_name: formData.full_name,
            phone: formData.phone,
            email: formData.email,
            avatar_url: avatarUrl,
          })
          .eq('id', member.lead_id);

        if (error) throw error;
      }

      // Update fitness goals, GSTIN, and fitness/diet profile on member record
      if (member?.id) {
        await supabase
          .from('members')
          .update({
            fitness_goals: formData.fitness_goals || null,
            gstin: formData.gstin || null,
            dietary_preference: formData.dietary_preference || null,
            cuisine_preference: formData.cuisine_preference || null,
            allergies: formData.allergies
              ? formData.allergies.split(',').map(s => s.trim()).filter(Boolean)
              : [],
            fitness_level: formData.fitness_level || null,
            activity_level: formData.activity_level || null,
            equipment_availability: equipmentAvailability,
            injuries_limitations: formData.injuries_limitations || null,
          })
          .eq('id', member.id);
      }

      toast.success('Profile updated successfully');
      invalidateMembersData(queryClient);
      queryClient.invalidateQueries({ queryKey: ['member-details', member.id] });
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  const initials = formData.full_name
    ?.split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase() || 'M';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Member Profile</SheetTitle>
          <SheetDescription>
            Update member's personal information and emergency contacts
          </SheetDescription>
        </SheetHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          {/* Avatar Section */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Avatar className="h-24 w-24">
                <AvatarImage src={avatarUrl || ''} />
                <AvatarFallback className="text-2xl bg-primary/10">{initials}</AvatarFallback>
              </Avatar>
              <label 
                htmlFor="avatar-upload" 
                className="absolute bottom-0 right-0 p-1.5 bg-primary rounded-full cursor-pointer hover:bg-primary/90 transition-colors"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 text-primary-foreground animate-spin" />
                ) : (
                  <Camera className="h-4 w-4 text-primary-foreground" />
                )}
              </label>
              <input 
                id="avatar-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
                disabled={isUploading}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Click camera icon to upload photo (for biometric ID)
            </p>
          </div>

          <Separator />

          {/* Personal Information */}
          <div className="space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <User className="h-4 w-4" /> Personal Information
            </h4>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="full_name">Full Name</Label>
                <Input
                  id="full_name"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Enter full name"
                  required
                />
              </div>
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
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="Enter email address"
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Fitness Goal */}
          <div className="space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <Target className="h-4 w-4" /> Fitness Goal
            </h4>
            <div className="space-y-2">
              <Label htmlFor="fitness_goals">Goal</Label>
              <Select value={formData.fitness_goals} onValueChange={(v) => setFormData({ ...formData, fitness_goals: v })}>
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
          </div>

          <Separator />

          {/* Emergency Contact */}
          <div className="space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Emergency Contact
            </h4>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="emergency_contact_name">Contact Name</Label>
                <Input
                  id="emergency_contact_name"
                  value={formData.emergency_contact_name}
                  onChange={(e) => setFormData({ ...formData, emergency_contact_name: e.target.value })}
                  placeholder="Emergency contact name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergency_contact_phone">Contact Phone</Label>
                <PhoneInput
                  id="emergency_contact_phone"
                  value={formData.emergency_contact_phone}
                  onChange={(value) => setFormData({ ...formData, emergency_contact_phone: value })}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* GSTIN */}
          <div className="space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              GSTIN (Tax ID)
            </h4>
            <div className="space-y-2">
              <Label htmlFor="gstin">GST Number</Label>
              <Input
                id="gstin"
                value={formData.gstin || ''}
                onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                placeholder="e.g., 08AABCU9603R1ZM"
                maxLength={15}
              />
              <p className="text-xs text-muted-foreground">Auto-fills on GST invoices for this member</p>
            </div>
          </div>

          <SheetFooter className="gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
