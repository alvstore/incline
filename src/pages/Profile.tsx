import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useUnifiedStaff } from '@/hooks/useUnifiedStaff';
import { useMemberData } from '@/hooks/useMemberData';


import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AvatarUpload } from '@/components/auth/AvatarUpload';
import { queueStaffSync } from '@/services/biometricService';
import { 
  User, Mail, Phone, Shield, Building2, Calendar, 
  KeyRound, Save, CheckCircle, AlertCircle 
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

export default function ProfilePage() {
  const { profile, user, roles, refreshProfile } = useAuth();
  const { data: staffList } = useUnifiedStaff();
  const { member } = useMemberData();
  const { branches } = useBranchContext();


  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [phone, setPhone] = useState(profile?.phone || '');
  const [emergencyName, setEmergencyName] = useState(profile?.emergency_contact_name || '');
  const [emergencyPhone, setEmergencyPhone] = useState(profile?.emergency_contact_phone || '');

  const primaryRole = roles[0];
  const roleLabel = typeof primaryRole === 'string' ? primaryRole : primaryRole?.role || 'user';
  const displayRole = roleLabel === 'owner' ? 'Admin' : roleLabel;

  // Fetch audit logs for activity timeline
  const { data: recentActivity = [] } = useQuery({
    queryKey: ['profile-activity', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('audit_logs')
        .select('id, action, action_description, table_name, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      return data || [];
    },
    enabled: !!user?.id,
  });

  const getInitials = (name: string | null) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          phone: phone || null,
          emergency_contact_name: emergencyName || null,
          emergency_contact_phone: emergencyPhone || null,
        })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      setIsEditing(false);
      toast.success('Profile updated successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!profile?.email) return;
    setIsResettingPassword(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) throw error;
      toast.success('Password reset email sent! Check your inbox.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send reset email');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'owner': case 'admin': return 'default';
      case 'manager': return 'secondary';
      case 'trainer': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">My Profile</h1>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: About Card */}
          <Card className="shadow-lg shadow-primary/5 rounded-2xl border-0 lg:col-span-1">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center">
                <AvatarUpload />
                <Badge variant={getRoleBadgeVariant(roleLabel)} className="capitalize mt-2">
                  {displayRole}
                </Badge>
              </div>

              <Separator className="my-6" />

              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">About</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Full Name</p>
                    <p className="text-sm font-medium">{profile?.full_name || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm font-medium">{profile?.email || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="text-sm font-medium">{profile?.phone || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Role</p>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {roles.map((r, i) => {
                        const rl = typeof r === 'string' ? r : r.role;
                        return (
                          <Badge key={i} variant="outline" className="text-xs capitalize">
                            {rl === 'owner' ? 'Admin' : rl}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {branches.length > 0 && (
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Branch</p>
                      <p className="text-sm font-medium">{branches[0]?.name || '—'}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Member Since</p>
                    <p className="text-sm font-medium">
                      {user?.created_at ? format(new Date(user.created_at), 'MMM dd, yyyy') : '—'}
                    </p>
                  </div>
                </div>
              </div>

              <Separator className="my-6" />

              <Button 
                variant="outline" 
                className="w-full" 
                onClick={handleResetPassword}
                disabled={isResettingPassword}
              >
                <KeyRound className="h-4 w-4 mr-2" />
                {isResettingPassword ? 'Sending...' : 'Send Password Reset Email'}
              </Button>
            </CardContent>
          </Card>

          {/* Right: Edit + Activity */}
          <div className="lg:col-span-2 space-y-6">
            {/* Editable Contact Card */}
            <Card className="shadow-lg shadow-primary/5 rounded-2xl border-0">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Contact Information</CardTitle>
                {!isEditing ? (
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                    Edit
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={isSaving}>
                      <Save className="h-4 w-4 mr-1" />
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-muted-foreground">Full Name</Label>
                    <Input value={profile?.full_name || ''} disabled className="mt-1 bg-muted/50" />
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Email</Label>
                    <Input value={profile?.email || ''} disabled className="mt-1 bg-muted/50" />
                  </div>
                  <div>
                    <Label>Phone Number</Label>
                    <Input 
                      value={phone} 
                      onChange={(e) => setPhone(e.target.value)} 
                      disabled={!isEditing}
                      className={`mt-1 ${!isEditing ? 'bg-muted/50' : ''}`}
                      placeholder="+91 9876543210"
                    />
                  </div>
                </div>

                <Separator />

                <h3 className="text-sm font-semibold text-muted-foreground">Emergency Contact</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Contact Name</Label>
                    <Input 
                      value={emergencyName} 
                      onChange={(e) => setEmergencyName(e.target.value)} 
                      disabled={!isEditing}
                      className={`mt-1 ${!isEditing ? 'bg-muted/50' : ''}`}
                    />
                  </div>
                  <div>
                    <Label>Contact Phone</Label>
                    <Input 
                      value={emergencyPhone} 
                      onChange={(e) => setEmergencyPhone(e.target.value)} 
                      disabled={!isEditing}
                      className={`mt-1 ${!isEditing ? 'bg-muted/50' : ''}`}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* HR / Staff Information (Read-only for Trainers/Staff) */}
            {(roles.some(r => ['trainer', 'staff', 'manager'].includes(r.role))) && (
              <Card className="shadow-lg shadow-primary/5 rounded-2xl border-0">
                <CardHeader>
                  <CardTitle className="text-lg">Staff Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const staff = staffList?.find(s => s.user_id === user?.id);
                    if (!staff) return <p className="text-sm text-muted-foreground">No HR records found.</p>;
                    
                    const trainerData = staff.trainer;
                    const employeeData = staff.employee;
                    
                    return (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label className="text-muted-foreground">Staff Code</Label>
                          <p className="text-sm font-medium mt-1">{staff.code || '—'}</p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Base Salary</Label>
                          <p className="text-sm font-medium mt-1">₹{(staff.salary || 0).toLocaleString()}</p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Salary Type</Label>
                          <p className="text-sm font-medium mt-1 capitalize">{trainerData?.salary_type || employeeData?.salary_type || 'Fixed'}</p>
                        </div>
                        {trainerData && (
                          <div>
                            <Label className="text-muted-foreground">PT Share %</Label>
                            <p className="text-sm font-medium mt-1">{trainerData.pt_share_percentage}%</p>
                          </div>
                        )}
                        <div>
                          <Label className="text-muted-foreground">Government ID (Aadhaar)</Label>
                          <p className="text-sm font-medium mt-1">
                            {trainerData?.government_id_number 
                              ? `XXXX XXXX ${trainerData.government_id_number.slice(-4)}`
                              : employeeData?.aadhaar_last4 
                                ? `XXXX XXXX ${employeeData.aadhaar_last4}`
                                : '—'}
                          </p>
                        </div>
                        <div className="sm:col-span-2">
                          <Label className="text-muted-foreground">Address</Label>
                          <p className="text-sm font-medium mt-1">
                            {staff.profile?.address ? `${staff.profile.address}${staff.profile.city ? `, ${staff.profile.city}` : ''}${staff.profile.state ? `, ${staff.profile.state}` : ''}` : '—'}
                          </p>
                        </div>


                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Activity Timeline */}

            <Card className="shadow-lg shadow-primary/5 rounded-2xl border-0">
              <CardHeader>
                <CardTitle className="text-lg">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                {recentActivity.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No recent activity</p>
                ) : (
                  <div className="space-y-4">
                    {recentActivity.map((activity: any) => (
                      <div key={activity.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            {activity.action === 'INSERT' ? (
                              <CheckCircle className="h-4 w-4 text-success" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-primary" />
                            )}
                          </div>
                          <div className="w-px flex-1 bg-border mt-1" />
                        </div>
                        <div className="pb-4">
                          <p className="text-sm font-medium">
                            {(activity.action_description || `${activity.action} on ${activity.table_name}`)
                              .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
                              .replace(/\s*""\s*/g, '')
                              .replace(/\s{2,}/g, ' ')
                              .trim()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(activity.created_at), 'MMM dd, yyyy HH:mm')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
