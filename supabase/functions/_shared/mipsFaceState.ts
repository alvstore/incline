// _shared/mipsFaceState.ts v1.0.0
// Per-device, per-person face enrolment ledger helpers.
//
// This firmware (1.42.x) exposes exactly one face metric over HTTP —
// `photoCount` on GET /through/device/list — and no per-device person roster.
// The ledger turns that single number into per-person truth by pushing ONE
// person at a time and attributing the resulting photoCount delta to them.
//
// States:
//   pending  — should be on the device, not confirmed yet
//   enrolled — the device's face counter moved for this person
//   rejected — repeatedly pushed, counter never moved → the terminal cannot
//              build a template from this photo; stop re-pushing, ask for a retake
//   missing  — was enrolled, device counter dropped (reset / re-registration)

export const REJECT_AFTER_ATTEMPTS = 3;

export interface FaceStateRow {
  id?: string;
  branch_id: string;
  device_id: string | null;
  mips_device_id: number;
  device_name: string | null;
  person_sn: string;
  person_type: "member" | "employee" | "trainer";
  person_id: string | null;
  person_name: string | null;
  state: "pending" | "enrolled" | "rejected" | "missing";
  reason: string | null;
  attempts: number;
  last_attempt_at: string | null;
  enrolled_at: string | null;
}

export interface LedgerPerson {
  table: "members" | "employees" | "trainers";
  type: "member" | "employee" | "trainer";
  id: string;
  sn: string;
  name: string | null;
}

export interface LedgerDevice {
  id: string | null;
  mips_device_id: number;
  name: string | null;
}

/** Create `pending` rows for every (device × person) pair that has none yet. */
export async function seedLedger(
  supabase: any,
  branchId: string,
  devices: LedgerDevice[],
  people: LedgerPerson[],
): Promise<void> {
  if (!devices.length || !people.length) return;
  const rows = devices.flatMap((d) =>
    people
      .filter((p) => !!p.sn)
      .map((p) => ({
        branch_id: branchId,
        device_id: d.id,
        mips_device_id: d.mips_device_id,
        device_name: d.name,
        person_sn: p.sn,
        person_type: p.type,
        person_id: p.id,
        person_name: p.name,
        state: "pending",
      })),
  );
  // Chunked so a large roster never blows the statement size.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("mips_device_face_state")
      .upsert(rows.slice(i, i + 200), {
        onConflict: "mips_device_id,person_sn",
        ignoreDuplicates: true,
      });
    if (error) console.warn("[faceState] seed error:", error.message);
  }
}

export async function readLedger(
  supabase: any,
  branchId: string,
): Promise<FaceStateRow[]> {
  const { data, error } = await supabase
    .from("mips_device_face_state")
    .select("*")
    .eq("branch_id", branchId)
    .limit(5000);
  if (error) {
    console.warn("[faceState] read error:", error.message);
    return [];
  }
  return (data || []) as FaceStateRow[];
}

export async function markEnrolled(
  supabase: any,
  branchId: string,
  mipsDeviceId: number,
  personSn: string,
): Promise<void> {
  await supabase
    .from("mips_device_face_state")
    .update({
      state: "enrolled",
      reason: null,
      enrolled_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
    })
    .eq("branch_id", branchId)
    .eq("mips_device_id", mipsDeviceId)
    .eq("person_sn", personSn);
}

/** Record a push that did not move the device counter. */
export async function markAttempt(
  supabase: any,
  branchId: string,
  mipsDeviceId: number,
  personSn: string,
  attempts: number,
  reason: string,
): Promise<void> {
  const next = attempts + 1;
  const rejected = next >= REJECT_AFTER_ATTEMPTS;
  await supabase
    .from("mips_device_face_state")
    .update({
      attempts: next,
      last_attempt_at: new Date().toISOString(),
      state: rejected ? "rejected" : "pending",
      reason: rejected
        ? `Device did not accept this photo after ${next} attempts — no usable face template. Ask the member for a new photo. (${reason})`
        : reason,
    })
    .eq("branch_id", branchId)
    .eq("mips_device_id", mipsDeviceId)
    .eq("person_sn", personSn);
}

/**
 * A photo change makes a previously rejected person eligible again.
 * Called whenever a new biometric photo lands for a person.
 */
export async function resetPersonState(
  supabase: any,
  personSn: string,
): Promise<void> {
  if (!personSn) return;
  await supabase
    .from("mips_device_face_state")
    .update({ state: "pending", attempts: 0, reason: "New photo uploaded — re-queued" })
    .eq("person_sn", personSn)
    .neq("state", "pending");
}
