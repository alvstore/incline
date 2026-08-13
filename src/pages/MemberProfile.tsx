import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AvatarUpload } from '@/components/auth/AvatarUpload';
import { useMemberData } from '@/hooks/useMemberData';
import { supabase } from '@/integrations/supabase/client';
import { User, Mail, Phone, MapPin, Calendar, Shield, AlertCircle, Loader2, KeyRound, HeartPulse } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { CommunicationPreferences } from '@/components/profile/CommunicationPreferences';
import { useQuery } from '@tanstack/react-query';
import { Badge as UIBadge } from '@/components/ui/badge';
import { PARQ_QUESTIONS, parseHealthConditions } from '@/lib/registration/healthQuestions';

export default function MemberProfile() {
  const { profile, refreshProfile } = useAuth();
  const { member, activeMembership, isLoading } = useMemberData();
  
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);

  const [formData, setFormData] = useState({
    phone: profile?.phone || '',
    emergency_contact_name: profile?.emergency_contact_name || '',
    emergency_contact_phone: profile?.emergency_contact_phone || '',
  });

  // Pull canonical health/fitness data straight from members + latest PAR-Q snapshot
  const { data: healthData } = useQuery({
    queryKey: ['member-health', member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const [memRes, parqRes] = await Promise.all([
        supabase.from('members').select('fitness_goals, health_conditions').eq('id', member!.id).maybeSingle(),
        supabase
          .from('member_onboarding_signatures')
          .select('par_q, signed_at')
          .eq('member_id', member!.id)
          .order('signed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        fitness_goals: memRes.data?.fitness_goals as string | null | undefined,
        health_conditions: memRes.data?.health_conditions as string | null | undefined,
        par_q: (parqRes.data?.par_q ?? null) as Record<string, string> | null,
        signed_at: parqRes.data?.signed_at as string | null | undefined,
      };
    },
  });

  const parsedConditions = parseHealthConditions(healthData?.health_conditions);
  const parqYesCount = healthData?.par_q
    ? PARQ_QUESTIONS.filter((q, i) => {
        const v = (healthData.par_q as Record<string, string>)[q] ?? (healthData.par_q as Record<string, string>)[`q${i}`];
        return v === 'yes';
      }).length
    : 0;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (profile?.id) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ 
            phone: formData.phone,
            emergency_contact_name: formData.emergency_contact_name || null,
            emergency_contact_phone: formData.emergency_contact_phone || null,
          })
          .eq('id', profile.id);

        if (profileError) throw profileError;
      }

      await refreshProfile();
      toast.success('Profile updated successfully');
      setIsEditing(false);
    } catch (error: any) {
      toast.error('Failed to update profile: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendPasswordReset = async () => {
    if (!profile?.email) {
      toast.error('No email address found');
      return;
    }
    setIsSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) throw error;
      toast.success('Password reset email sent! Check your inbox.');
    } catch (error: any) {
      toast.error('Failed to send reset email: ' + error.message);
    } finally {
      setIsSendingReset(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
          <p className="text-muted-foreground">Your account is not linked to a member profile.</p>
        </div>
      </AppLayout>
    );
  }

  const getInitials = (name: string | null) => {
    if (!name) return 'M';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <User className="h-8 w-8 text-accent" />
              My Profile
            </h1>
            <p className="text-muted-foreground">
              Manage your personal information
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSendPasswordReset} disabled={isSendingReset}>
              <KeyRound className="h-4 w-4 mr-2" />
              {isSendingReset ? 'Sending...' : 'Reset Password'}
            </Button>
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Changes
                </Button>
              </>
            ) : (
              <Button onClick={() => setIsEditing(true)}>Edit Profile</Button>
            )}
          </div>
        </div>

        {/* Profile Card */}
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <AvatarUpload />

              <div className="text-center sm:text-left">
                <h2 className="text-2xl font-bold">{profile?.full_name}</h2>
                <p className="text-muted-foreground">Member ID: {member.member_code}</p>
                <div className="flex flex-wrap gap-2 mt-2 justify-center sm:justify-start">
                  <Badge variant={member.status === 'active' ? 'default' : 'secondary'}>
                    {member.status}
                  </Badge>
                  {activeMembership && (
                    <Badge variant="outline">{activeMembership.plan?.name}</Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Personal Information */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Personal Information</CardTitle>
            <CardDescription>Your personal details and contact information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Full Name
                </Label>
                <Input value={profile?.full_name || ''} disabled />
                <p className="text-xs text-muted-foreground">Contact admin to change your name</p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email
                </Label>
                <Input value={profile?.email || ''} disabled />
                <p className="text-xs text-muted-foreground">Email cannot be changed</p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  Phone
                </Label>
                <Input
                  value={isEditing ? formData.phone : (profile?.phone || '')}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={!isEditing}
                  placeholder="Enter phone number"
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  Member Since
                </Label>
                <Input
                  value={member.joined_at ? format(new Date(member.joined_at), 'dd MMM yyyy') : 'Not set'}
                  disabled
                />
              </div>


              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Status
                </Label>
                <Input value={member.status || 'Not set'} disabled className="capitalize" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Emergency Contact
            </CardTitle>
            <CardDescription>Contact person in case of emergency</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Contact Name</Label>
                <Input
                  value={isEditing ? formData.emergency_contact_name : (profile?.emergency_contact_name || '')}
                  onChange={(e) => setFormData({ ...formData, emergency_contact_name: e.target.value })}
                  disabled={!isEditing}
                  placeholder="Emergency contact name"
                />
              </div>

              <div className="space-y-2">
                <Label>Contact Phone</Label>
                <Input
                  value={isEditing ? formData.emergency_contact_phone : (profile?.emergency_contact_phone || '')}
                  onChange={(e) => setFormData({ ...formData, emergency_contact_phone: e.target.value })}
                  disabled={!isEditing}
                  placeholder="Emergency contact phone"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Membership Info */}
        {activeMembership && (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Membership Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Plan</p>
                  <p className="font-medium">{activeMembership.plan?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Start Date</p>
                  <p className="font-medium">{format(new Date(activeMembership.start_date), 'dd MMM yyyy')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">End Date</p>
                  <p className="font-medium">{format(new Date(activeMembership.end_date), 'dd MMM yyyy')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Branch Info */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Branch
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-accent/10">
                <MapPin className="h-6 w-6 text-accent" />
              </div>
              <div>
                <p className="font-medium">{(member as any)?.branch?.name || 'Main Branch'}</p>
                <p className="text-sm text-muted-foreground">Your home branch</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Health & Fitness (read-only — edits via staff registration drawer) */}
        {(healthData?.fitness_goals || healthData?.health_conditions || healthData?.par_q) && (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <HeartPulse className="h-5 w-5" />
                Health & Fitness
              </CardTitle>
              <CardDescription>From your registration form</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {healthData?.fitness_goals && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Primary Goal</p>
                  <UIBadge variant="secondary">{healthData.fitness_goals}</UIBadge>
                </div>
              )}
              {parsedConditions.selected.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Health Conditions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {parsedConditions.selected.map((c) => (
                      <UIBadge key={c} variant="outline">
                        {c === 'Other' && parsedConditions.other ? `Other: ${parsedConditions.other}` : c}
                      </UIBadge>
                    ))}
                  </div>
                </div>
              )}
              {healthData?.par_q && (
                <div className="flex items-center gap-2 text-sm pt-2 border-t border-border/50">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">PAR-Q completed</span>
                  <UIBadge variant={parqYesCount > 0 ? 'destructive' : 'default'}>
                    {parqYesCount} flagged
                  </UIBadge>
                  {healthData.signed_at && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {format(new Date(healthData.signed_at), 'dd MMM yyyy')}
                    </span>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                To update, contact reception — these answers form part of your signed waiver.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Communication preferences */}
        {member?.id && (member as any)?.branch_id && (
          <CommunicationPreferences memberId={member.id} branchId={(member as any).branch_id} />
        )}
      </div>
    </AppLayout>
  );
}
