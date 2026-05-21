import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { BookOpen, Plus, Eye, FileSignature, Users, Download } from 'lucide-react';

type Policy = {
  id: string;
  code: string;
  title: string;
  version: number;
  effective_from: string;
  applicable_roles: string[];
  body_markdown: string;
  is_active: boolean;
  branch_id: string | null;
};

export default function PoliciesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Policy> | null>(null);
  const [viewing, setViewing] = useState<Policy | null>(null);

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['policies-library'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policies')
        .select('*')
        .eq('is_active', true)
        .order('code', { ascending: true })
        .order('version', { ascending: false });
      if (error) throw error;
      return data as Policy[];
    },
  });

  const { data: ackCounts = {} } = useQuery({
    queryKey: ['policy-ack-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_acknowledgements')
        .select('policy_id');
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of data || []) map[(r as any).policy_id] = (map[(r as any).policy_id] || 0) + 1;
      return map;
    },
  });

  const save = useMutation({
    mutationFn: async (p: Partial<Policy>) => {
      const payload = {
        code: p.code,
        title: p.title,
        version: p.version ?? 1,
        body_markdown: p.body_markdown,
        effective_from: p.effective_from || new Date().toISOString().slice(0, 10),
        applicable_roles: p.applicable_roles ?? ['owner', 'admin', 'manager', 'staff', 'trainer'],
        is_active: true,
      };
      if (p.id) {
        const { error } = await supabase.from('policies').update(payload).eq('id', p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('policies').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Policy saved');
      qc.invalidateQueries({ queryKey: ['policies-library'] });
      setEditing(null);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to save'),
  });

  const downloadStampedPdf = async (policyId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-policy-pdf', {
        body: { policyId }
      });
      if (error) throw error;
      window.open(data.url, '_blank');
    } catch (e: any) {
      toast.error('Failed to generate PDF: ' + e.message);
    }
  };

  const latestByCode = new Map<string, Policy>();
  for (const p of policies) {
    if (!latestByCode.has(p.code)) latestByCode.set(p.code, p);
  }
  const list = Array.from(latestByCode.values());

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-indigo-600" /> Policy Library</CardTitle>
            <CardDescription>Versioned, role-scoped, e-sign ready policies. All employees must acknowledge applicable policies.</CardDescription>
          </div>
          <Button onClick={() => setEditing({ code: '', title: '', version: 1, body_markdown: '', applicable_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'] })} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="h-4 w-4 mr-1" /> New policy
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
          ) : list.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
              No policies yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {list.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 truncate">{p.title}</span>
                      <Badge variant="outline" className="text-[10px]">{p.code}</Badge>
                      <Badge className="bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px]">v{p.version}</Badge>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
                      <span>Effective {p.effective_from}</span>
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{p.applicable_roles.join(', ')}</span>
                      <span>{ackCounts[p.id] ?? 0} acknowledgements</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => downloadStampedPdf(p.id)} title="Download Stamped PDF"><Download className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setViewing(p)}><Eye className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)}><FileSignature className="h-3.5 w-3.5 mr-1" />Edit</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing?.id ? 'Edit policy' : 'New policy'}</SheetTitle>
            <SheetDescription>Markdown-formatted body. Bumping version creates a new acknowledgement cycle.</SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="space-y-3 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Code *</Label>
                  <Input value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase().replace(/\s+/g, '_') })} placeholder="code_of_conduct" />
                </div>
                <div className="space-y-1.5">
                  <Label>Version *</Label>
                  <Input type="number" value={editing.version ?? 1} onChange={(e) => setEditing({ ...editing, version: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Title *</Label>
                <Input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Effective from</Label>
                <Input type="date" value={editing.effective_from ?? new Date().toISOString().slice(0, 10)} onChange={(e) => setEditing({ ...editing, effective_from: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Body (Markdown) *</Label>
                <Textarea rows={18} value={editing.body_markdown ?? ''} onChange={(e) => setEditing({ ...editing, body_markdown: e.target.value })} className="font-mono text-xs" />
              </div>
            </div>
          )}
          <SheetFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => editing && save.mutate(editing)} disabled={save.isPending}>{save.isPending ? 'Saving...' : 'Save policy'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{viewing?.title}</SheetTitle>
            <SheetDescription>v{viewing?.version} · effective {viewing?.effective_from}</SheetDescription>
          </SheetHeader>
          <div className="py-4 whitespace-pre-wrap text-sm leading-relaxed">{viewing?.body_markdown}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
