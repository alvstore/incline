import { supabase } from '@/integrations/supabase/client';

export interface Notification {
  id: string;
  user_id: string;
  branch_id: string | null;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'reminder';
  category: string | null;
  is_read: boolean;
  action_url: string | null;
  metadata: any;
  created_at: string;
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  email_membership_reminders: boolean;
  email_payment_receipts: boolean;
  email_class_notifications: boolean;
  email_announcements: boolean;
  push_low_stock: boolean;
  push_new_leads: boolean;
  push_payment_alerts: boolean;
  push_task_reminders: boolean;
  whatsapp_task_notifications: boolean;
}

// Notifications
export async function fetchNotifications(userId: string, limit = 20) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Server-side dedupe trigger (notifications_dedupe_guard) prevents duplicate
  // unread rows within a 60-second window, so no client-side filtering needed.
  return (data || []) as Notification[];
}

export async function fetchUnreadCount(userId: string) {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
  return count || 0;
}

export async function markAsRead(notificationId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);
  if (error) throw error;
}

export async function markAllAsRead(userId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
}

export async function createNotification(notification: Omit<Notification, 'id' | 'created_at' | 'is_read'>) {
  const { data, error } = await supabase
    .from('notifications')
    .insert({ ...notification, is_read: false })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Notification Preferences
export async function fetchPreferences(userId: string) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as NotificationPreferences | null;
}

export async function upsertPreferences(userId: string, preferences: Partial<NotificationPreferences>) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: userId, ...preferences }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
