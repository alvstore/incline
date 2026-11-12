import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';

export interface PickedMember {
  id: string;
  member_code: string;
  full_name: string;
}

interface Props {
  value: PickedMember | null;
  onChange: (m: PickedMember | null) => void;
  label?: string;
  required?: boolean;
}

export function MemberSearchPicker({ value, onChange, label = 'Select Member', required }: Props) {
  const [term, setTerm] = useState('');

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['fitness-create-member-search', term],
    enabled: !value && term.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_members', {
        search_term: term,
        p_branch_id: null,
        p_limit: 8,
      });
      if (error) throw error;
      return (data || []).filter((m: any) => m.member_status === 'active');
    },
  });

  if (value) {
    return (
      <div className="space-y-2">
        <Label>{label}{required && ' *'}</Label>
        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
          <div>
            <p className="font-medium text-sm">{value.full_name}</p>
            <p className="text-xs text-muted-foreground">{value.member_code}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)} className="gap-1">
            <X className="h-3.5 w-3.5" /> Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>{label}{required && ' *'}</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, code, phone, email…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="pl-10"
        />
      </div>
      {term.length >= 2 && (
        <div className="border rounded-lg max-h-48 overflow-y-auto">
          {isFetching ? (
            <div className="p-3 text-sm text-muted-foreground text-center">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground text-center">No members found</div>
          ) : (
            results.map((m: any) => (
              <button type="button"
                key={m.id}
                onClick={() => {
                  onChange({ id: m.id, member_code: m.member_code, full_name: m.full_name });
                  setTerm('');
                }}
                className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center justify-between border-b last:border-b-0"
              >
                <span className="font-medium">{m.full_name}</span>
                <span className="text-xs text-muted-foreground">{m.member_code}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
