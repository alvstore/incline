import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export interface ZohoStatus {
  success: boolean;
  mode: 'connector' | 'direct';
  redirect_uri: string;
  has_client: boolean;
  client_id_hint: string | null;
  connected: boolean;
  dc: 'in' | 'com' | 'eu';
  organization_id: string | null;
  org_name: string | null;
  connected_at: string | null;
  connected_by_name: string | null;
  last_test_ok_at: string | null;
  last_refresh_error: string | null;
}

export const ZOHO_STATUS_KEY = ['zoho-connection-status'] as const;

export async function zohoAction<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('zoho-oauth', { body });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try { msg = (await error.context.json()).error ?? msg; } catch { /* keep */ }
    }
    throw new Error(msg);
  }
  const res = data as { success?: boolean; error?: string };
  if (!res?.success) throw new Error(res?.error || 'Request failed');
  return data as T;
}

export type ZohoBadge = 'not_configured' | 'direct' | 'connector' | 'reconnect';

export function zohoBadge(s: ZohoStatus | undefined): ZohoBadge {
  if (!s) return 'not_configured';
  if (s.has_client && s.connected && s.last_refresh_error) return 'reconnect';
  if (s.mode === 'direct' && s.connected) return 'direct';
  if (!s.has_client) return s.mode === 'connector' ? 'connector' : 'not_configured';
  return 'connector';
}
