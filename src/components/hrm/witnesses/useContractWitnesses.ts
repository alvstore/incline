import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ContractWitness {
  id: string;
  branch_id: string | null;
  full_name: string;
  phone: string | null;
  designation: string | null;
  signature_path: string | null;
  is_active: boolean;
}

export const WITNESS_BUCKET = 'witness-signatures';

/** Saved witnesses for a branch (plus org-wide ones with no branch). */
export function useContractWitnesses(branchId: string | null | undefined, includeInactive = false) {
  return useQuery({
    queryKey: ['contract-witnesses', branchId ?? 'all', includeInactive],
    queryFn: async (): Promise<ContractWitness[]> => {
      let q = supabase.from('contract_witnesses')
        .select('id, branch_id, full_name, phone, designation, signature_path, is_active')
        .order('full_name');
      if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      if (!includeInactive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ContractWitness[];
    },
  });
}

export function useWitnessSignatureUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['witness-signature-url', path],
    enabled: !!path,
    staleTime: 50_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(WITNESS_BUCKET).createSignedUrl(path!, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
