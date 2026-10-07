// HOWBODY device inventory service — admin/owner write, all staff read.
import { supabase } from "@/integrations/supabase/client";

export interface HowbodyDevice {
  id: string;
  equipment_no: string;
  branch_id: string | null;
  label: string | null;
  location: string | null;
  notes: string | null;
  is_active: boolean;
  auto_registered: boolean;
  last_seen_at: string | null;
  total_scans: number;
  created_at: string;
  updated_at: string;
}

export interface HowbodyDeviceInput {
  equipment_no: string;
  branch_id?: string | null;
  label?: string | null;
  location?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export async function listHowbodyDevices(): Promise<HowbodyDevice[]> {
  const { data, error } = await supabase
    .from("howbody_devices")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as HowbodyDevice[];
}

export async function getHowbodyDeviceLabel(equipmentNo: string): Promise<string | null> {
  if (!equipmentNo) return null;
  const { data } = await supabase
    .from("howbody_devices")
    .select("label, location")
    .eq("equipment_no", equipmentNo)
    .maybeSingle();
  if (!data) return null;
  return data.label || data.location || null;
}

export async function createHowbodyDevice(input: HowbodyDeviceInput): Promise<HowbodyDevice> {
  const payload = {
    equipment_no: input.equipment_no.trim(),
    branch_id: input.branch_id || null,
    label: input.label?.trim() || null,
    location: input.location?.trim() || null,
    notes: input.notes?.trim() || null,
    is_active: input.is_active ?? true,
    auto_registered: false,
  };
  const { data, error } = await supabase
    .from("howbody_devices")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as HowbodyDevice;
}

export async function updateHowbodyDevice(id: string, input: Partial<HowbodyDeviceInput>): Promise<HowbodyDevice> {
  const patch: Record<string, unknown> = {};
  if (input.equipment_no !== undefined) patch.equipment_no = input.equipment_no.trim();
  if (input.branch_id !== undefined) patch.branch_id = input.branch_id || null;
  if (input.label !== undefined) patch.label = input.label?.trim() || null;
  if (input.location !== undefined) patch.location = input.location?.trim() || null;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  const { data, error } = await supabase
    .from("howbody_devices")
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as HowbodyDevice;
}

export async function deleteHowbodyDevice(id: string): Promise<void> {
  const { error } = await supabase.from("howbody_devices").delete().eq("id", id);
  if (error) throw error;
}
