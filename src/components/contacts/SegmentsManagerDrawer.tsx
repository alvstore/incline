import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listSegments, saveSegment, deleteSegment, resolveCampaignAudience, AudienceFilter, AudienceKind } from '@/services/campaignService';
import { toast } from 'sonner';
import { Layers, Trash2, Users, Sparkles, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string;
}

export function SegmentsManagerDrawer({ open, onOpenChange, branchId }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<AudienceKind>('contacts');
  const [memberStatus, setMemberStatus] = useState<'all' | 'active' | 'expired'>('all');
  const [categories, setCategories] = useState<string>('');
  const [tags, setTags] = useState<string>('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const { data: segments = [] } = useQuery({
    queryKey: ['contact-segments', branchId],
    enabled: open && !!branchId,
    queryFn: () => listSegments(branchId),
  });

  const buildFilter = (): AudienceFilter => ({
    audience_kind: kind,
    member_status: memberStatus,
    categories: categories.split(',').map((s) => s.trim()).filter(Boolean),
    tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
  });

  const refreshPreview = useMutation({
    mutationFn: () => resolveCampaignAudience(branchId, buildFilter()),
    onSuccess: (rows) => setPreviewCount(rows.length),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Segment name is required');
      return saveSegment({ branch_id: branchId, name, description, filter: buildFilter() });
    },
    onSuccess: () => {
      toast.success('Segment saved');
      setName(''); setDescription(''); setPreviewCount(null);
      qc.invalidateQueries({ queryKey: ['contact-segments', branchId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteSegment(id),
    onSuccess: () => {
      toast.success('Segment deleted');
      qc.invalidateQueries({ queryKey: ['contact-segments', branchId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-primary/15 text-primary"><Layers className="h-5 w-5" /></span>
            Marketing Segments
          </SheetTitle>
          <SheetDescription>
            Save reusable audience filters across members, leads and contacts. Use them to launch targeted WhatsApp / Email / SMS broadcasts.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Builder */}
          <div className="rounded-2xl border bg-muted p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> New segment
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hot Leads, Corporate Vendors" />
              </div>
              <div className="space-y-1">
                <Label>Audience kind</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as AudienceKind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="members">Members only</SelectItem>
                    <SelectItem value="leads">Leads only</SelectItem>
                    <SelectItem value="contacts">Contacts only</SelectItem>
                    <SelectItem value="mixed">Mixed (members + leads + contacts)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(kind === 'members' || kind === 'mixed') && (
              <div className="space-y-1">
                <Label>Member status</Label>
                <Select value={memberStatus} onValueChange={(v) => setMemberStatus(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All members</SelectItem>
                    <SelectItem value="active">Active only</SelectItem>
                    <SelectItem value="expired">Expired only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {(kind === 'contacts' || kind === 'mixed') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Categories (comma-separated)</Label>
                  <Input value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="vendor, prospect" />
                </div>
                <div className="space-y-1">
                  <Label>Tags (comma-separated)</Label>
                  <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="winter-promo, walk-in" />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => refreshPreview.mutate()} disabled={refreshPreview.isPending}>
                <Users className="h-4 w-4 mr-2" />
                {refreshPreview.isPending ? 'Counting…' : 'Preview audience size'}
              </Button>
              {previewCount !== null && (
                <Badge variant="secondary" className="rounded-full">{previewCount} matching contact{previewCount === 1 ? '' : 's'}</Badge>
              )}
            </div>

            <Button className="w-full rounded-xl" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Saving…' : 'Save segment'}
            </Button>
          </div>

          {/* Existing segments */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Saved segments ({segments.length})</h3>
            {segments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No segments yet. Save your first audience above.</p>
            ) : (
              segments.map((s) => (
                <div key={s.id} className="rounded-xl border bg-card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.audience_count} contacts · refreshed {s.last_refreshed_at ? new Date(s.last_refreshed_at).toLocaleString() : 'never'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="icon" className="rounded-xl"
                      title="Use in new campaign"
                      onClick={() => {
                        sessionStorage.setItem('campaign_prefill_segment', s.id);
                        sessionStorage.setItem('campaign_prefill_segment_name', s.name);
                        navigate('/campaigns');
                        onOpenChange(false);
                      }}
                    >
                      <Send className="h-4 w-4 text-primary" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="rounded-xl text-destructive"
                      onClick={() => delMut.mutate(s.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
