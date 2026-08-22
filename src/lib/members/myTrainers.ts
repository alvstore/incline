import { supabase } from '@/integrations/supabase/client';

/**
 * Trainer directory entry visible to the signed-in member.
 * Members have no RLS read access to `trainers` / trainer `profiles`, so the
 * data is served by the `get_my_trainers()` security-definer RPC which returns
 * only the trainers actually linked to that member.
 */
export interface MyTrainer {
  trainer_id: string;
  full_name: string;
  avatar_url: string | null;
  trainer_code: string | null;
  specializations: string[] | null;
  relation: 'assigned' | 'pt_package' | 'pt_session' | string;
}

export async function fetchMyTrainers(): Promise<MyTrainer[]> {
  const { data, error } = await (supabase as any).rpc('get_my_trainers');
  if (error) {
    console.error('get_my_trainers failed:', error.message);
    return [];
  }
  return (data ?? []) as MyTrainer[];
}

export function trainersById(list: MyTrainer[]): Record<string, MyTrainer> {
  const map: Record<string, MyTrainer> = {};
  for (const t of list) map[t.trainer_id] = t;
  return map;
}
