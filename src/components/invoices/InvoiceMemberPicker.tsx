import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X, User, Loader2 } from 'lucide-react';

export interface InvoiceMember {
  id: string;
  member_code: string;
  full_name: string;
  phone: string | null;
}

interface Props {
  branchId: string;
  value: InvoiceMember | null;
  onChange: (m: InvoiceMember | null) => void;
}

export function InvoiceMemberPicker({ branchId, value, onChange }: Props) {
  const [term, setTerm] = useState('');

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['invoice-member-search', branchId, term],
    enabled: !value && term.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_members', {
        search_term: term.trim(),
        p_branch_id: branchId || null,
        p_limit: 8,
      });
      if (error) throw error;
      return data || [];
    },
  });

  if (value) {
    return (
      <div className="flex items-center justify-between p-3 rounded-xl border bg-slate-50">
        <div className="min-w-0">
          <p className="font-medium text-sm text-slate-900 truncate">{value.full_name}</p>
          <p className="text-xs text-slate-500">
            {value.member_code}
            {value.phone ? ` · ${value.phone}` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="gap-1 cursor-pointer" onClick={() => onChange(null)}>
          <X className="h-3.5 w-3.5" /> Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          aria-label="Search member by name, code, phone or email"
          placeholder="Search by name, member code, mobile or email…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="pl-10"
        />
      </div>
      {term.trim().length >= 2 && (
        <div className="border rounded-xl max-h-52 overflow-y-auto">
          {isFetching ? (
            <div className="p-3 text-sm text-slate-500 flex items-center gap-2 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-slate-500 text-center">No members found — billing as walk-in.</div>
          ) : (
            results.map((m: any) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange({ id: m.id, member_code: m.member_code, full_name: m.full_name, phone: m.phone ?? null });
                  setTerm('');
                }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm flex items-center justify-between gap-2 border-b last:border-b-0 cursor-pointer"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="truncate font-medium text-slate-900">{m.full_name}</span>
                </span>
                <span className="text-xs text-slate-500 shrink-0">
                  {m.member_code}
                  {m.phone ? ` · ${m.phone}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">Leave empty to bill a walk-in customer.</p>
    </div>
  );
}
