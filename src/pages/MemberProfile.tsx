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
import { User, Mail, Phone, MapPin, Calendar, Shield, AlertCircle, Loader2, KeyRound, HeartPulse, Pencil, CreditCard, LogOut } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, parseISO } from 'date-fns';
import { getISTNow, getISTToday } from '@/lib/utils/datetime';
import { toast } from 'sonner';
import { CommunicationPreferences } from '@/components/profile/CommunicationPreferences';
import { useQuery } from '@tanstack/react-query';
import { Badge as UIBadge } from '@/components/ui/badge';
import { PARQ_QUESTIONS, parseHealthConditions } from '@/lib/registration/healthQuestions';
import { MemberPasswordSheet } from '@/components/member/MemberPasswordSheet';

export default function MemberProfile() {
  const { profile, refreshProfile, resetPassword, signOut } = useAuth();
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
      const { error } = await resetPassword(profile.email);
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

  const daysLeft = activeMembership?.end_date
    ? Math.max(0, Math.ceil((parseISO(activeMembership.end_date).getTime() - Date.now()) / 86400000))
    : null;
  const row = (Icon: typeof User, label: string, value: string | null | undefined) => (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-4 w-4" aria-hidden /></span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value || 'Not set'}</p>
      </div>
    </div>
  );
  const cardCls = 'rounded-2xl bg-card shadow-lg shadow-slate-200/50 dark:shadow-none';

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-5 sm:px-6">
        {/* Identity card */}
        <section className="relative overflow-hidden rounded-2xl bg-theme-gradient p-6 text-white shadow-xl shadow-primary/20">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col items-center gap-3 text-center">
            <AvatarUpload />
            <div>
              <h1 className="text-xl font-bold">{profile?.full_name}</h1>
              <p className="text-xs text-white/80">{member.member_code} · {(member as any)?.branch?.name || 'The Incline'}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold capitalize">{member.status}</span>
              {activeMembership?.plan?.name && <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">{activeMembership.plan.name}</span>}
            </div>
          </div>
          <div className="relative mt-5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/15 p-2.5"><p className="text-[11px] text-white/80">Member since</p><p className="text-sm font-bold">{member.joined_at ? format(parseISO(member.joined_at), 'MMM yyyy') : '—'}</p></div>
            <div className="rounded-xl bg-white/15 p-2.5"><p className="text-[11px] text-white/80">Days left</p><p className="text-sm font-bold">{daysLeft ?? '—'}</p></div>
            <div className="rounded-xl bg-white/15 p-2.5"><p className="text-[11px] text-white/80">Valid till</p><p className="text-sm font-bold">{activeMembership?.end_date ? format(parseISO(activeMembership.end_date), 'dd MMM yy') : '—'}</p></div>
          </div>
        </section>

        <Tabs defaultValue="details" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl bg-card p-1.5 shadow-lg shadow-slate-200/50 dark:shadow-none">
            <TabsTrigger value="details" className="min-h-10 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Details</TabsTrigger>
            <TabsTrigger value="health" className="min-h-10 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Health</TabsTrigger>
            <TabsTrigger value="settings" className="min-h-10 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4">
            <section className={cardCls}>
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact</h2>
                {!isEditing && <Button size="sm" variant="ghost" className="min-h-9 text-primary" onClick={() => { setFormData({ phone: profile?.phone || '', emergency_contact_name: profile?.emergency_contact_name || '', emergency_contact_phone: profile?.emergency_contact_phone || '' }); setIsEditing(true); }}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button>}
              </div>
              {isEditing ? (
                <div className="space-y-4 p-4">
                  <div className="space-y-1.5"><Label htmlFor="pf-phone">Phone</Label><Input id="pf-phone" type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="pf-ecn">Emergency contact name</Label><Input id="pf-ecn" value={formData.emergency_contact_name} onChange={(e) => setFormData({ ...formData, emergency_contact_name: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="pf-ecp">Emergency contact phone</Label><Input id="pf-ecp" type="tel" value={formData.emergency_contact_phone} onChange={(e) => setFormData({ ...formData, emergency_contact_phone: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="min-h-11" onClick={() => setIsEditing(false)}>Cancel</Button>
                    <Button className="min-h-11" onClick={handleSave} disabled={isSaving}>{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {row(Mail, 'Email', profile?.email)}
                  {row(Phone, 'Phone', profile?.phone)}
                  {row(Shield, 'Emergency contact', profile?.emergency_contact_name ? `${profile.emergency_contact_name}${profile.emergency_contact_phone ? ' · ' + profile.emergency_contact_phone : ''}` : null)}
                </div>
              )}
            </section>
            <section className={cardCls}>
              <h2 className="px-4 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Membership</h2>
              <div className="divide-y divide-border/60">
                {row(CreditCard, 'Plan', activeMembership?.plan?.name || 'No active plan')}
                {activeMembership && row(Calendar, 'Validity', `${format(parseISO(activeMembership.start_date), 'dd MMM yyyy')} – ${format(parseISO(activeMembership.end_date), 'dd MMM yyyy')}`)}
                {row(MapPin, 'Home branch', (member as any)?.branch?.name || 'Main Branch')}
              </div>
            </section>
            <p className="px-1 text-xs text-muted-foreground">To change your name or email, please contact reception.</p>
          </TabsContent>

          <TabsContent value="health" className="space-y-4">
            <section className={`${cardCls} space-y-4 p-4`}>
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><HeartPulse className="h-4 w-4" />Health & fitness</h2>
              {!(healthData?.fitness_goals || parsedConditions.selected.length || healthData?.par_q) && <p className="text-sm text-muted-foreground">No health details on file yet.</p>}
              {healthData?.fitness_goals && <div><p className="mb-1 text-xs text-muted-foreground">Primary goal</p><UIBadge variant="secondary">{healthData.fitness_goals}</UIBadge></div>}
              {parsedConditions.selected.length > 0 && (
                <div><p className="mb-2 text-xs text-muted-foreground">Health conditions</p><div className="flex flex-wrap gap-1.5">{parsedConditions.selected.map((c) => <UIBadge key={c} variant="outline">{c === 'Other' && parsedConditions.other ? `Other: ${parsedConditions.other}` : c}</UIBadge>)}</div></div>
              )}
              {healthData?.par_q && (
                <div className="flex items-center gap-2 border-t border-border/50 pt-3 text-sm">
                  <span className="text-muted-foreground">Health questionnaire</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${parqYesCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{parqYesCount > 0 ? `${parqYesCount} flagged` : 'Clear'}</span>
                  {healthData.signed_at && <span className="ml-auto text-xs text-muted-foreground">{format(parseISO(healthData.signed_at), 'dd MMM yyyy')}</span>}
                </div>
              )}
              <p className="text-xs text-muted-foreground">To update, contact reception — these answers are part of your signed waiver.</p>
            </section>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <section className={`${cardCls} space-y-3 p-4`}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Security</h2>
              <div className="flex flex-wrap gap-2">
                <MemberPasswordSheet />
                <Button variant="outline" className="min-h-11" onClick={handleSendPasswordReset} disabled={isSendingReset}>
                  {isSendingReset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}Email reset link
                </Button>
              </div>
            </section>
            {member?.id && (member as any)?.branch_id && (
              <CommunicationPreferences memberId={member.id} branchId={(member as any).branch_id} />
            )}
            <Button variant="ghost" className="min-h-11 w-full rounded-2xl bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700" onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" />Sign out
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
