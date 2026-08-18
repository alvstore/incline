import { useState, useEffect } from 'react';
import { Search, User, Phone, Hash, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MemberHistorySearchProps {
  branchId: string | undefined;
  onSelect: (member: any) => void;
  selectedMemberId?: string;
}

export function MemberHistorySearch({ branchId, onSelect, selectedMemberId }: MemberHistorySearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!query.trim() || query.length < 2 || !branchId) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase.rpc('search_members', {
          search_term: query,
          p_branch_id: branchId,
          p_limit: 8
        });

        if (error) throw error;
        setResults(data || []);
        setIsOpen(true);
      } catch (err) {
        console.error('Member search error:', err);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, branchId]);

  return (
    <div className="relative w-full max-w-xl mx-auto">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search member by name, phone, or code..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) setIsOpen(false);
          }}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
          className="h-12 pl-10 pr-10 rounded-2xl border-indigo-100 bg-white shadow-sm focus-visible:ring-indigo-500 transition-all text-base"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-indigo-500" />
        )}
      </div>

      {isOpen && results.length > 0 && (
        <Card className="absolute top-full mt-2 w-full z-50 overflow-hidden rounded-2xl border-0 shadow-2xl shadow-indigo-500/10 bg-white animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="max-h-[300px] overflow-y-auto p-2">
            {results.map((member) => (
              <button
                key={member.id}
                onClick={() => {
                  onSelect(member);
                  setQuery('');
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-150 text-left hover:bg-indigo-50/50 group",
                  selectedMemberId === member.id && "bg-indigo-50"
                )}
              >
                <Avatar className="h-10 w-10 border border-indigo-50">
                  <AvatarImage src={member.avatar_url || undefined} />
                  <AvatarFallback className="bg-indigo-100 text-indigo-700 font-semibold">
                    {member.full_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 truncate group-hover:text-indigo-600 transition-colors">
                    {member.full_name}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Hash className="h-3 w-3" />
                      {member.member_code}
                    </span>
                    {member.phone && (
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Phone className="h-3 w-3" />
                        {member.phone}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {isOpen && query.length >= 2 && results.length === 0 && !isLoading && (
        <Card className="absolute top-full mt-2 w-full z-50 p-8 text-center rounded-2xl border-0 shadow-2xl shadow-indigo-500/10 bg-white">
          <User className="mx-auto h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm text-slate-500 font-medium">No members found matching "{query}"</p>
        </Card>
      )}
    </div>
  );
}
