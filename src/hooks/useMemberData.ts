import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { hydrateMeasurementPhotoUrls } from '@/lib/measurements/photoSigning';
import { fetchMyTrainers, trainersById } from '@/lib/members/myTrainers';

export function useMemberData() {
  const { user } = useAuth();

  // Trainers linked to this member (RLS-safe, via get_my_trainers RPC).
  const { data: myTrainers = [] } = useQuery({
    queryKey: ['my-trainers', user?.id],
    enabled: !!user,
    queryFn: fetchMyTrainers,
    staleTime: 5 * 60 * 1000,
  });
  const trainerMap = trainersById(myTrainers);

  // Get linked member record for current user
  const { data: member, isLoading: memberLoading } = useQuery({
    queryKey: ['my-member', user?.id, myTrainers.length],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select(`
          *,
          branch:branches(id, name, code)
        `)
        .eq('user_id', user!.id)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching member:', error);
        return null;
      }
      
      if (!data) return null;

      // Attach the assigned trainer's display info from the RPC map.
      const assigned = data.assigned_trainer_id ? trainerMap[data.assigned_trainer_id] : undefined;
      const assignedTrainer = assigned
        ? {
            id: assigned.trainer_id,
            profile: { full_name: assigned.full_name, avatar_url: assigned.avatar_url },
          }
        : null;

      return { ...data, assigned_trainer: assignedTrainer };

    },
  });


  // Get active membership
  const { data: activeMembership, isLoading: membershipLoading } = useQuery({
    queryKey: ['my-membership', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select(`
          *,
          plan:membership_plans(id, name, duration_days, price, max_freeze_days)
        `)
        .eq('member_id', member!.id)
        .in('status', ['active', 'frozen'])
        .order('end_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
  });

  // Get PT packages
  const { data: ptPackages = [] } = useQuery({
    queryKey: ['my-pt-packages', member?.id, myTrainers.length],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_pt_packages')
        .select(`
          *,
          package:pt_packages(name, total_sessions)
        `)
        .eq('member_id', member!.id)
        .in('status', ['active', 'expired']);
      
      if (error) throw error;

      // Trainer display info comes from the RLS-safe RPC map.
      return (data || []).map((pkg: any) => {
        const t = pkg.trainer_id ? trainerMap[pkg.trainer_id] : undefined;
        return {
          ...pkg,
          trainer: t
            ? {
                id: t.trainer_id,
                profile: { full_name: t.full_name, avatar_url: t.avatar_url },
                profiles: { full_name: t.full_name, avatar_url: t.avatar_url },
              }
            : null,
        };
      });
    },
  });


  // Get recent attendance
  const { data: recentAttendance = [] } = useQuery({
    queryKey: ['my-attendance', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_attendance')
        .select('*')
        .eq('member_id', member!.id)
        .order('check_in', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data || [];
    },
  });

  // Get pending invoices
  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ['my-pending-invoices', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('member_id', member!.id)
        .in('status', ['pending', 'partial', 'overdue'])
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Get upcoming classes
  const { data: upcomingClasses = [] } = useQuery({
    queryKey: ['my-upcoming-classes', member?.id, myTrainers.length],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select(`
          *,
          class:classes(id, name, scheduled_at, duration_minutes, trainer_id)
        `)
        .eq('member_id', member!.id)
        .eq('status', 'booked')
        .order('booked_at', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      
      const now = new Date();
      const futureBookings = (data || []).filter((b: any) => 
        b.class?.scheduled_at && new Date(b.class.scheduled_at) >= now
      ).slice(0, 5);
      
      return futureBookings.map((booking: any) => {
        const t = booking.class?.trainer_id ? trainerMap[booking.class.trainer_id] : undefined;
        if (!t) return booking;
        return {
          ...booking,
          class: {
            ...booking.class,
            trainer: {
              id: t.trainer_id,
              profile: { full_name: t.full_name },
              profiles: { full_name: t.full_name },
            },
          },
        };
      });
    },
  });


  // Get measurements
  const { data: measurements = [] } = useQuery({
    queryKey: ['my-measurements', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_measurements')
        .select('*, recorded_by_profile:profiles!member_measurements_recorded_by_fkey(full_name)')
        .eq('member_id', member!.id)
        .order('recorded_at', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return hydrateMeasurementPhotoUrls(data || []);
    },
    // Refresh signed photo URLs well before the 1h TTL so long sessions stay valid.
    staleTime: 25 * 60 * 1000,
    refetchInterval: 25 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Calculate days remaining
  const daysRemaining = activeMembership
    ? Math.max(0, Math.ceil((new Date(activeMembership.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return {
    actor: member,
    member,
    activeMembership,
    ptPackages,
    myTrainers,
    trainerMap,
    recentAttendance,
    pendingInvoices,
    upcomingClasses,
    measurements,
    daysRemaining,
    isLoading: memberLoading || membershipLoading,
  };
}

export function useUnifiedActor() {
  const { member, isLoading: memberLoading, activeMembership, daysRemaining } = useMemberData();
  const { trainer, isLoading: trainerLoading } = useTrainerData();

  const actor = member || (trainer ? { ...trainer, role: 'trainer' } : null);
  // Deep audit: Use trainer's branch_id if member profile is missing
  if (actor && !actor.branch_id && trainer?.branch_id) {
    (actor as any).branch_id = trainer.branch_id;
  }


  const isLoading = memberLoading || trainerLoading;

  return {
    actor,
    member,
    trainer,
    activeMembership,
    daysRemaining,
    isLoading
  };
}

export function useTrainerData() {
  const { user } = useAuth();

  // Get linked trainer record for current user
  const { data: trainer, isLoading: trainerLoading } = useQuery({
    queryKey: ['my-trainer', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trainers')
        .select(`
          *,
          branch:branches(id, name, code)
        `)
        .eq('user_id', user!.id)
        .single();
      
      if (error) {
        console.error('Error fetching trainer:', error);
        return null;
      }
      return data;
    },
  });

  // Get general training clients (assigned_trainer_id)
  const { data: generalClients = [] } = useQuery({
    queryKey: ['my-general-clients', trainer?.id],
    enabled: !!trainer,
    queryFn: async () => {
      const query = supabase
        .from('members')
        .select('id, member_code, user_id, status, fitness_goals')
        .eq('assigned_trainer_id', trainer!.id)
        .eq('status', 'active');
      const { data, error } = await query;

      if (error) throw error;

      const withProfiles = await Promise.all(
        (data || []).map(async (m: any) => {
          if (m.user_id) {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('full_name, avatar_url, phone')
              .eq('id', m.user_id)
              .maybeSingle();
            return { ...m, profile: profileData };
          }
          return m;
        })
      );
      return withProfiles;
    },
  });

  // Get PT clients (from member_pt_packages)
  const { data: ptClients = [] } = useQuery({
    queryKey: ['my-pt-clients', trainer?.id],
    enabled: !!trainer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_pt_packages')
        .select(`
          *,
          member:members!member_pt_packages_member_id_fkey(id, member_code, user_id),
          package:pt_packages(name)
        `)
        .eq('trainer_id', trainer!.id)
        .eq('status', 'active');
      
      if (error) throw error;
      
      const clientsWithProfiles = await Promise.all(
        (data || []).map(async (client: any) => {
          if (client.member?.user_id) {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('full_name, avatar_url, phone')
              .eq('id', client.member.user_id)
              .maybeSingle();
            return {
              ...client,
              member: { ...client.member, profile: profileData }
            };
          }
          return client;
        })
      );
      return clientsWithProfiles;
    },
  });

  // Get today's sessions
  const { data: todaySessions = [] } = useQuery({
    queryKey: ['my-today-sessions', trainer?.id],
    enabled: !!trainer,
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('pt_sessions')
        .select(`
          *,
          member_pt_packages!inner(
            member_id,
            members!inner(id, member_code, user_id, profiles:user_id(full_name))
          )
        `)
        .eq('trainer_id', trainer!.id)
        .gte('scheduled_at', today)
        .lt('scheduled_at', tomorrow)
        .order('scheduled_at', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Get my classes
  const { data: myClasses = [] } = useQuery({
    queryKey: ['my-trainer-classes', trainer?.id],
    enabled: !!trainer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .eq('trainer_id', trainer!.id)
        .eq('is_active', true)
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(10);
      
      if (error) throw error;
      return data || [];
    },
  });

  // A member who bought PT from this trainer is a *personal training* client —
  // never list them in the General roster as well (that double-counted the
  // roster and made the same person appear twice).
  const ptMemberIds = new Set(
    (ptClients as any[]).map((c: any) => c.member_id).filter(Boolean),
  );
  const generalOnlyClients = (generalClients as any[]).filter(
    (m: any) => !ptMemberIds.has(m.id),
  );

  return {
    trainer,
    generalClients: generalOnlyClients,
    ptClients,
    ptMemberIds,
    clients: ptClients, // backward compat
    todaySessions,
    myClasses,
    isLoading: trainerLoading,
  };
}

