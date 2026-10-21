import { isTemporaryPhotoUrl } from '@/lib/media/personAvatar';
import { supabase } from "@/integrations/supabase/client";

export interface BiometricSyncItem {
  id: string;
  member_id?: string;
  staff_id?: string;
  device_id?: string;
  sync_type: 'add' | 'update' | 'delete';
  photo_url: string;
  person_uuid: string;
  person_name: string;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
  retry_count: number;
  error_message?: string;
  queued_at?: string;
  processed_at?: string;
}

export interface MemberSyncAudit {
  totalActiveMembers: number;
  membersWithHardwareAccess: number;
  membersWithBiometricPhoto: number;
  eligibleForAppSync: number;
  eligibleForDeviceEnrollment: number;
  blockedByNoPhoto: number;
  blockedByAccessDisabled: number;
}

/** Also update biometric_photo_url when avatar changes (avatar = biometric unification) */
export const syncAvatarToBiometric = async (
  userId: string,
  avatarUrl: string
): Promise<void> => {
  // Update member biometric photo
  await supabase
    .from('members')
    .update({ biometric_photo_url: avatarUrl })
    .eq('user_id', userId);

  // Update employee biometric photo
  await supabase
    .from('employees')
    .update({ biometric_photo_url: avatarUrl })
    .eq('user_id', userId);
};

export const queueMemberSync = async (
  memberId: string,
  photoUrl: string,
  personName: string,
  deviceIds?: string[]
): Promise<BiometricSyncItem[]> => {
  let targetDevices: string[] = deviceIds || [];
  
  if (!deviceIds || deviceIds.length === 0) {
    const { data: devices } = await supabase
      .from('access_devices')
      .select('id')
      .in('device_type', ['face_terminal', 'face terminal']);
    
    targetDevices = devices?.map(d => d.id) || [];
  }

  if (targetDevices.length === 0) {
    throw new Error('No face recognition devices found');
  }

  const syncItems = targetDevices.map(deviceId => ({
    member_id: memberId,
    device_id: deviceId,
    sync_type: 'add' as const,
    photo_url: photoUrl,
    person_uuid: memberId,
    person_name: personName,
    status: 'pending' as const,
    retry_count: 0,
  }));

  const { data, error } = await supabase
    .from('biometric_sync_queue')
    .upsert(syncItems, { onConflict: 'member_id,device_id' })
    .select();

  if (error) throw error;
  
  await supabase
    .from('members')
    .update({ 
      ...(isTemporaryPhotoUrl(photoUrl) ? {} : { biometric_photo_url: photoUrl }),
      biometric_enrolled: false
    })
    .eq('id', memberId);

  return (data || []) as BiometricSyncItem[];
};

export const queueStaffSync = async (
  staffId: string,
  photoUrl: string,
  personName: string,
  deviceIds?: string[]
): Promise<BiometricSyncItem[]> => {
  const { data: employee, error: employeeLookupError } = await supabase
    .from('employees')
    .select('id')
    .eq('id', staffId)
    .maybeSingle();

  if (employeeLookupError) throw employeeLookupError;

  // Defensive fallback for accidental trainer ID usage.
  if (!employee) {
    return queueTrainerSync(staffId, photoUrl, personName, deviceIds);
  }

  let targetDevices: string[] = deviceIds || [];
  
  if (!deviceIds || deviceIds.length === 0) {
    const { data: devices } = await supabase
      .from('access_devices')
      .select('id')
      .in('device_type', ['face_terminal', 'face terminal']);
    
    targetDevices = devices?.map(d => d.id) || [];
  }

  if (targetDevices.length === 0) {
    throw new Error('No face recognition devices found');
  }

  const syncItems = targetDevices.map(deviceId => ({
    staff_id: staffId,
    device_id: deviceId,
    sync_type: 'add' as const,
    photo_url: photoUrl,
    person_uuid: staffId,
    person_name: personName,
    status: 'pending' as const,
    retry_count: 0,
  }));

  const { data, error } = await supabase
    .from('biometric_sync_queue')
    .upsert(syncItems, { onConflict: 'staff_id,device_id' })
    .select();

  if (error) throw error;
  
  await supabase
    .from('employees')
    .update({ 
      ...(isTemporaryPhotoUrl(photoUrl) ? {} : { biometric_photo_url: photoUrl }),
      biometric_enrolled: false
    })
    .eq('id', staffId);

  return (data || []) as BiometricSyncItem[];
};

export const queueTrainerSync = async (
  trainerId: string,
  photoUrl: string,
  personName: string,
  deviceIds?: string[]
): Promise<BiometricSyncItem[]> => {
  let targetDevices: string[] = deviceIds || [];
  
  if (!deviceIds || deviceIds.length === 0) {
    const { data: devices } = await supabase
      .from('access_devices')
      .select('id')
      .in('device_type', ['face_terminal', 'face terminal']);
    
    targetDevices = devices?.map(d => d.id) || [];
  }

  if (targetDevices.length === 0) {
    throw new Error('No face recognition devices found');
  }

  const syncItems = targetDevices.map(deviceId => ({
    device_id: deviceId,
    sync_type: 'add' as const,
    photo_url: photoUrl,
    person_uuid: trainerId,
    person_name: personName,
    status: 'pending' as const,
    retry_count: 0,
  }));

  const { data, error } = await supabase
    .from('biometric_sync_queue')
    .upsert(syncItems, { onConflict: 'person_uuid,device_id' })
    .select();

  if (error) throw error;
  
  await supabase
    .from('trainers')
    .update({ 
      ...(isTemporaryPhotoUrl(photoUrl) ? {} : { biometric_photo_url: photoUrl }),
      biometric_enrolled: false
    } as any)
    .eq('id', trainerId);

  return (data || []) as BiometricSyncItem[];
};

export const getSyncStatus = async (
  personId: string,
  type: 'member' | 'staff' | 'trainer'
): Promise<BiometricSyncItem[]> => {
  const column = type === 'member' ? 'member_id' : type === 'staff' ? 'staff_id' : 'person_uuid';
  
  const { data, error } = await supabase
    .from('biometric_sync_queue')
    .select('*')
    .eq(column, personId)
    .order('queued_at', { ascending: false });

  if (error) throw error;
  return (data || []) as BiometricSyncItem[];
};

export const removeBiometricData = async (
  personId: string,
  type: 'member' | 'staff' | 'trainer',
  deviceIds?: string[]
): Promise<void> => {
  const column = type === 'member' ? 'member_id' : type === 'staff' ? 'staff_id' : 'person_uuid';
  
  let query = supabase
    .from('biometric_sync_queue')
    .update({ sync_type: 'delete', status: 'pending' })
    .eq(column, personId);

  if (deviceIds && deviceIds.length > 0) {
    query = query.in('device_id', deviceIds);
  }

  const { error } = await query;
  if (error) throw error;

  const table = type === 'member' ? 'members' : type === 'staff' ? 'employees' : 'trainers';
  await supabase
    .from(table)
    .update({ biometric_enrolled: false })
    .eq('id', personId);
};

export const getPendingSyncItems = async (deviceId?: string): Promise<BiometricSyncItem[]> => {
  let query = supabase
    .from('biometric_sync_queue')
    .select('*')
    .eq('status', 'pending')
    .order('queued_at');

  if (deviceId) {
    query = query.eq('device_id', deviceId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as BiometricSyncItem[];
};

export const markSyncComplete = async (
  syncId: string,
  success: boolean,
  errorMessage?: string
): Promise<void> => {
  const updates: Partial<BiometricSyncItem> = {
    status: success ? 'completed' : 'failed',
    processed_at: new Date().toISOString(),
  };

  if (!success && errorMessage) {
    updates.error_message = errorMessage;
    const { data: current } = await supabase
      .from('biometric_sync_queue')
      .select('retry_count, member_id, staff_id, person_uuid')
      .eq('id', syncId)
      .single();
    
    if (current) {
      updates.retry_count = (current.retry_count || 0) + 1;
    }
  }

  const { error } = await supabase
    .from('biometric_sync_queue')
    .update(updates)
    .eq('id', syncId);

  if (error) throw error;

  if (success) {
    const { data: syncItem } = await supabase
      .from('biometric_sync_queue')
      .select('member_id, staff_id, person_uuid')
      .eq('id', syncId)
      .single();

    if (syncItem?.member_id) {
      await supabase
        .from('members')
        .update({ biometric_enrolled: true })
        .eq('id', syncItem.member_id);
    } else if (syncItem?.staff_id) {
      const { data: updatedEmployees } = await supabase
        .from('employees')
        .update({ biometric_enrolled: true })
        .eq('id', syncItem.staff_id)
        .select('id');

      if (!updatedEmployees || updatedEmployees.length === 0) {
        await supabase
          .from('trainers')
          .update({ biometric_enrolled: true })
          .eq('id', syncItem.staff_id);
      }
    } else if (syncItem?.person_uuid) {
      const { data: updatedEmployees } = await supabase
        .from('employees')
        .update({ biometric_enrolled: true })
        .eq('id', syncItem.person_uuid)
        .select('id');

      if (!updatedEmployees || updatedEmployees.length === 0) {
        await supabase
          .from('trainers')
          .update({ biometric_enrolled: true })
          .eq('id', syncItem.person_uuid);
      }
    }
  }
};

export const getBiometricStats = async (branchId?: string) => {
  let memberQuery = supabase
    .from('members')
    .select('biometric_enrolled, status');
  
  if (branchId) {
    memberQuery = memberQuery.eq('branch_id', branchId);
  }

  const { data: members } = await memberQuery;

  let employeeQuery = supabase
    .from('employees')
    .select('biometric_enrolled, is_active');

  if (branchId) {
    employeeQuery = employeeQuery.eq('branch_id', branchId);
  }

  const { data: employees } = await employeeQuery;

  let trainerQuery = supabase
    .from('trainers')
    .select('biometric_enrolled, is_active');

  if (branchId) {
    trainerQuery = trainerQuery.eq('branch_id', branchId);
  }

  const { data: trainers } = await trainerQuery;

  const activeMembers = (members || []).filter((m) => m.status === 'active');
  const activeEmployees = (employees || []).filter((e) => e.is_active === true);
  const activeTrainers = (trainers || []).filter((t) => t.is_active === true);

  const enrolledMembers = activeMembers.filter((m) => m.biometric_enrolled === true).length;
  const enrolledEmployees = activeEmployees.filter((e) => e.biometric_enrolled === true).length;
  const enrolledTrainers = activeTrainers.filter((t) => t.biometric_enrolled === true).length;

  const totalMembers = activeMembers.length;
  const totalEmployees = activeEmployees.length;
  const totalTrainers = activeTrainers.length;

  const enrolledTotal = enrolledMembers + enrolledEmployees + enrolledTrainers;
  const totalPeople = totalMembers + totalEmployees + totalTrainers;

  const { count: pendingCount } = await supabase
    .from('biometric_sync_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  return {
    enrolledTotal,
    totalPeople,
    enrolledEmployees,
    enrolledTrainers,
    totalEmployees,
    totalTrainers,
    enrolledMembers,
    totalMembers,
    enrollmentRate: totalPeople > 0 ? Math.round((enrolledTotal / totalPeople) * 100) : 0,
    pendingSyncs: pendingCount || 0,
  };
};

export const getMemberSyncAudit = async (branchId?: string): Promise<MemberSyncAudit> => {
  let memberQuery = supabase
    .from('members')
    .select('biometric_photo_url, hardware_access_enabled')
    .eq('status', 'active');

  if (branchId) {
    memberQuery = memberQuery.eq('branch_id', branchId);
  }

  const { data: members, error } = await memberQuery;
  if (error) throw error;

  const rows = members || [];
  const totalActiveMembers = rows.length;
  const membersWithHardwareAccess = rows.filter((m) => m.hardware_access_enabled === true).length;
  const membersWithBiometricPhoto = rows.filter((m) => !!m.biometric_photo_url).length;
  const eligibleForAppSync = rows.filter(
    (m) => m.hardware_access_enabled === true && !!m.biometric_photo_url
  ).length;

  return {
    totalActiveMembers,
    membersWithHardwareAccess,
    membersWithBiometricPhoto,
    eligibleForAppSync,
    eligibleForDeviceEnrollment: membersWithHardwareAccess,
    blockedByNoPhoto: Math.max(0, membersWithHardwareAccess - eligibleForAppSync),
    blockedByAccessDisabled: Math.max(0, totalActiveMembers - membersWithHardwareAccess),
  };
};

/**
 * Sync branch members/staff/trainers to devices.
 * IMPORTANT: Now includes members WITHOUT photos so the device can enroll faces locally.
 */
export const syncBranchMembersToDevices = async (branchId?: string): Promise<{
  members: number;
  staff: number;
  trainers: number;
  people: number;
  devices: number;
  queued: number;
  audit: MemberSyncAudit;
}> => {
  let deviceQuery = supabase
    .from('access_devices')
    .select('id')
    .in('device_type', ['face_terminal', 'face terminal']);

  if (branchId) {
    deviceQuery = deviceQuery.eq('branch_id', branchId);
  }

  const { data: devices, error: devicesError } = await deviceQuery;
  if (devicesError) throw devicesError;

  const targetDevices = (devices || []).map((d) => d.id);
  if (targetDevices.length === 0) {
    throw new Error('No face recognition devices found for the selected branch');
  }

  // Members — NO photo filter, include all with hardware access
  let memberQuery = supabase
    .from('members')
    .select('id, user_id, member_code, biometric_photo_url')
    .eq('status', 'active')
    .eq('hardware_access_enabled', true);

  if (branchId) {
    memberQuery = memberQuery.eq('branch_id', branchId);
  }

  const { data: members, error: membersError } = await memberQuery;
  if (membersError) throw membersError;

  const activeMembers = members || [];

  // Staff — NO photo filter
  let staffQuery = supabase
    .from('employees')
    .select('id, user_id, employee_code, biometric_photo_url')
    .eq('is_active', true);

  if (branchId) {
    staffQuery = staffQuery.eq('branch_id', branchId);
  }

  const { data: employees, error: staffError } = await staffQuery;
  if (staffError) throw staffError;

  const activeEmployees = employees || [];

  // Trainers — NO photo filter
  let trainerQuery = supabase
    .from('trainers')
    .select('id, user_id, biometric_photo_url')
    .eq('is_active', true);

  if (branchId) {
    trainerQuery = trainerQuery.eq('branch_id', branchId);
  }

  const { data: trainers, error: trainersError } = await trainerQuery;
  if (trainersError) throw trainersError;

  const activeTrainers = trainers || [];

  const audit = await getMemberSyncAudit(branchId);

  const totalPeople = activeMembers.length + activeEmployees.length + activeTrainers.length;

  if (totalPeople === 0) {
    return {
      members: 0,
      staff: 0,
      trainers: 0,
      people: 0,
      devices: targetDevices.length,
      queued: 0,
      audit,
    };
  }

  const userIds = [
    ...activeMembers.map((member) => member.user_id),
    ...activeEmployees.map((employee) => employee.user_id),
    ...activeTrainers.map((trainer) => trainer.user_id),
  ].filter(Boolean);

  const profileMap: Record<string, string> = {};

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);

    if (profilesError) throw profilesError;

    (profiles || []).forEach((profile) => {
      profileMap[profile.id] = profile.full_name || 'Member';
    });
  }

  const memberSyncItems = activeMembers.flatMap((member) => {
    const personName = profileMap[member.user_id] || member.member_code || 'Member';

    return targetDevices.map((deviceId) => ({
      member_id: member.id,
      device_id: deviceId,
      sync_type: 'add' as const,
      photo_url: member.biometric_photo_url || '', // Allow empty — device will capture
      person_uuid: member.id,
      person_name: personName,
      status: 'pending' as const,
      retry_count: 0,
    }));
  });

  const staffSyncItems = activeEmployees.flatMap((employee) => {
    const personName = profileMap[employee.user_id] || employee.employee_code || 'Staff';

    return targetDevices.map((deviceId) => ({
      staff_id: employee.id,
      device_id: deviceId,
      sync_type: 'add' as const,
      photo_url: employee.biometric_photo_url || '',
      person_uuid: employee.id,
      person_name: personName,
      status: 'pending' as const,
      retry_count: 0,
    }));
  });

  const trainerSyncItems = activeTrainers.flatMap((trainer) => {
    const personName = profileMap[trainer.user_id] || 'Trainer';

    return targetDevices.map((deviceId) => ({
      device_id: deviceId,
      sync_type: 'add' as const,
      photo_url: trainer.biometric_photo_url || '',
      person_uuid: trainer.id,
      person_name: personName,
      status: 'pending' as const,
      retry_count: 0,
    }));
  });

  if (memberSyncItems.length > 0) {
    const { error: membersUpsertError } = await supabase
      .from('biometric_sync_queue')
      .upsert(memberSyncItems, { onConflict: 'member_id,device_id' });

    if (membersUpsertError) throw membersUpsertError;
  }

  if (staffSyncItems.length > 0) {
    const { error: staffUpsertError } = await supabase
      .from('biometric_sync_queue')
      .upsert(staffSyncItems, { onConflict: 'staff_id,device_id' });

    if (staffUpsertError) throw staffUpsertError;
  }

  if (trainerSyncItems.length > 0) {
    const { error: trainerUpsertError } = await supabase
      .from('biometric_sync_queue')
      .upsert(trainerSyncItems, { onConflict: 'person_uuid,device_id' });

    if (trainerUpsertError) throw trainerUpsertError;
  }

  const queuedTotal = memberSyncItems.length + staffSyncItems.length + trainerSyncItems.length;

  await supabase
    .from('access_devices')
    .update({ last_sync: new Date().toISOString() })
    .in('id', targetDevices);

  return {
    members: activeMembers.length,
    staff: activeEmployees.length,
    trainers: activeTrainers.length,
    people: totalPeople,
    devices: targetDevices.length,
    queued: queuedTotal,
    audit,
  };
};
