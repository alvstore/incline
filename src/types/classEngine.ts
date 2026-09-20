import type { Database } from '@/integrations/supabase/types';

export type ClassShift = Database['public']['Enums']['class_shift_type'];

export type ClassTypeRow = Database['public']['Tables']['class_types']['Row'];
export type ClassTypeInsert = Database['public']['Tables']['class_types']['Insert'];
export type ClassTypeUpdate = Database['public']['Tables']['class_types']['Update'];

export type ClassTemplateRow = Database['public']['Tables']['class_templates']['Row'];
export type ClassTemplateInsert = Database['public']['Tables']['class_templates']['Insert'];
export type ClassTemplateUpdate = Database['public']['Tables']['class_templates']['Update'];

export type ClassSessionRow = Database['public']['Tables']['classes']['Row'];

/** Parent class type with its schedule rules and a live count of upcoming sessions. */
export interface ClassTypeWithTemplates extends ClassTypeRow {
  templates: ClassTemplateRow[];
  upcoming_sessions: number;
}

export interface ClassSessionTypeSummary {
  id: string;
  name: string;
  image_url: string | null;
  category: string;
}

/** A bookable session (a `classes` row) enriched for display. */
export interface ClassSession extends ClassSessionRow {
  class_type: ClassSessionTypeSummary | null;
  trainer_name: string | null;
}

export interface MemberClassBooking {
  id: string;
  class_id: string;
  status: Database['public']['Enums']['class_booking_status'];
}

export type ClassSessionEvent = 'session_cancelled' | 'session_updated';

export interface SessionActionResult {
  success: boolean;
  error?: string;
  class_id?: string;
  already_cancelled?: boolean;
  already_active?: boolean;
  cancelled_bookings?: number;
  paid_bookings?: number;
  credits_released?: number;
  trainer_changed?: boolean;
  time_changed?: boolean;
  member_ids?: string[];
}

export interface DeleteTemplateResult {
  success: boolean;
  error?: string;
  deleted_sessions?: number;
  cancelled_sessions?: number;
  cancelled_class_ids?: string[];
  member_ids?: string[];
}

export interface GenerateSessionsResult {
  success: boolean;
  templates: number;
  inserted: number;
  as_of: string;
}

export interface NotifyResult {
  success: boolean;
  members: number;
  sent: number;
  error?: string;
}

export interface OverrideSessionInput {
  classId: string;
  trainerId?: string | null;
  externalTrainerName?: string | null;
  clearTrainer?: boolean;
  capacity?: number | null;
  startTime?: string | null; // HH:mm
  durationMinutes?: number | null;
  venue?: string | null;
}
