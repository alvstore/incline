import { supabase } from '@/integrations/supabase/client';
import { compressImageFile } from '@/utils/imageCompression';
import { uploadBiometricPhoto } from '@/lib/media/biometricPhotoUrls';
import { checkPersonPhoto } from '@/lib/media/checkPersonPhoto';
import { queueMemberSync, queueStaffSync, queueTrainerSync } from '@/services/biometricService';

export type PersonEntity = 'members' | 'employees' | 'trainers';

export interface PersonRef {
  entityType: PersonEntity;
  entityId: string;
}

/**
 * Find the member / employee / trainer record owned by an auth user.
 * Used by the generic avatar uploaders (self-service profile, staff drawers)
 * so ANY photo upload automatically feeds the biometric pipeline.
 */
export async function resolvePersonEntity(userId: string): Promise<PersonRef | null> {
  const [member, employee, trainer] = await Promise.all([
    supabase.from('members').select('id').eq('user_id', userId).maybeSingle(),
    supabase.from('employees').select('id').eq('user_id', userId).maybeSingle(),
    supabase.from('trainers').select('id').eq('user_id', userId).maybeSingle(),
  ]);
  if (member.data?.id) return { entityType: 'members', entityId: member.data.id };
  if (employee.data?.id) return { entityType: 'employees', entityId: employee.data.id };
  if (trainer.data?.id) return { entityType: 'trainers', entityId: trainer.data.id };
  return null;
}

async function queueForEntity(
  ref: PersonRef,
  signedUrl: string,
  personName: string,
): Promise<void> {
  if (ref.entityType === 'members') {
    await queueMemberSync(ref.entityId, signedUrl, personName);
  } else if (ref.entityType === 'employees') {
    await queueStaffSync(ref.entityId, signedUrl, personName);
  } else {
    await queueTrainerSync(ref.entityId, signedUrl, personName);
  }
}

/**
 * A fresh photo clears any `rejected` state in the per-gate enrolment ledger so
 * the face sweep picks the person up again on its next tick.
 */
async function requeueFaceEnrolment(ref: PersonRef): Promise<void> {
  const { data } = await supabase
    .from(ref.entityType)
    .select('mips_person_sn')
    .eq('id', ref.entityId)
    .maybeSingle();
  const sn = (data as { mips_person_sn?: string | null } | null)?.mips_person_sn;
  if (!sn) return;
  await supabase
    .from('mips_device_face_state')
    .update({ state: 'pending', attempts: 0, reason: 'New photo uploaded — re-queued' })
    .eq('person_sn', sn)
    .neq('state', 'pending');
}

export interface UploadPersonPhotoArgs {
  file: File;
  /** Auth user id — required, avatars bucket RLS keys on this folder. */
  userId: string;
  personName: string;
  /** Skip the lookup when the caller already knows the entity. */
  person?: PersonRef | null;
}

export interface UploadPersonPhotoResult {
  avatarUrl: string;
  person: PersonRef | null;
  queued: boolean;
  queueError?: string;
}

/**
 * Single path for every avatar upload in the app:
 *   compress → avatars bucket → profiles.avatar_url
 *   → private biometric copy → biometric_photo_path
 *   → biometric_sync_queue row (cron pushes to MIPS + devices within 5 min)
 *
 * No manual "sync to device" step is ever required.
 */
export async function uploadAndSyncPersonPhoto({
  file,
  userId,
  personName,
  person,
}: UploadPersonPhotoArgs): Promise<UploadPersonPhotoResult> {
  // Reject photos the turnstiles will never be able to enrol, before they
  // enter the pipeline and fail silently at the gate days later.
  const check = await checkPersonPhoto(file);
  if (!check.ok) throw new Error(check.reason || 'This photo cannot be used for face enrolment.');

  const compressed = await compressImageFile(file);

  const filePath = `${userId}/avatar-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, compressed, { upsert: true, contentType: 'image/jpeg' });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(filePath);
  const avatarUrl = `${pub.publicUrl}?v=${Date.now()}`;

  await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
    .eq('id', userId);

  const ref = person ?? (await resolvePersonEntity(userId));
  if (!ref) return { avatarUrl, person: null, queued: false };

  let queued = false;
  let queueError: string | undefined;
  try {
    const { path, signedUrl } = await uploadBiometricPhoto(ref.entityType, ref.entityId, compressed);
    await supabase
      .from(ref.entityType)
      .update({ biometric_photo_path: path, biometric_photo_url: avatarUrl })
      .eq('id', ref.entityId);
    await queueForEntity(ref, signedUrl, personName);
    // A new photo makes a previously rejected enrolment eligible again.
    await requeueFaceEnrolment(ref);
    queued = true;
  } catch (e: unknown) {
    queueError = e instanceof Error ? e.message : String(e);
    console.warn('Biometric queue failed:', queueError);
  }


  return { avatarUrl, person: ref, queued, queueError };
}
