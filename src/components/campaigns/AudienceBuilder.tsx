import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, UserPlus, Briefcase, Contact2, Layers, Bookmark, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  resolveAudienceMemberIds,
  resolveCampaignAudience,
  type AudienceFilter,
  type AudienceKind,
  type StaffRole,
} from '@/services/campaignService';

interface Props {
  branchId: string;
  value: AudienceFilter;
  onChange: (filter: AudienceFilter) => void;
  onResolved: (memberIds: string[]) => void;
  channel?: 'whatsapp' | 'email' | 'sms';
}

const KIND_OPTIONS: { id: AudienceKind; label: string; desc: string; icon: any; color: string }[] = [
  { id: 'members',  label: 'Members',          desc: 'Gym members in this branch',      icon: Users,     color: 'violet' },
  { id: 'leads',    label: 'Leads',            desc: 'Prospects from CRM pipeline',     icon: UserPlus,  color: 'amber' },
  { id: 'staff',    label: 'Staff & Trainers', desc: 'Owners, managers, staff, trainers', icon: Briefcase, color: 'blue' },
  { id: 'contacts', label: 'Contacts (CRM)',   desc: 'Saved contacts and tagged lists', icon: Contact2,  color: 'emerald' },
  { id: 'mixed',    label: 'Mixed',            desc: 'Combine multiple audiences',      icon: Layers,    color: 'indigo' },
  { id: 'segment',  label: 'Saved Segment',    desc: 'Use a previously saved audience', icon: Bookmark,  color: 'rose' },
];

const STAFF_ROLES: { id: StaffRole; label: string }[] = [
  { id: 'owner',   label: 'Owner' },
  { id: 'admin',   label: 'Admin' },
  { id: 'manager', label: 'Manager' },
  { id: 'staff',   label: 'Staff' },
  { id: 'trainer', label: 'Trainer' },
];

export function AudienceBuilder({ branchId, value, onChange, onResolved, channel }: Props) {
  // Normalize legacy `status` field into the new shape on first mount
  const initial: AudienceFilter = useMemo(() => {
    const v = { ...value };
    if (!v.audience_kind) v.audience_kind = 'members';
    if (v.audience_kind === 'members' && !v.member_status && v.status) {
      v.member_status = v.status === 'lead' ? 'all' : v.status;
    }
    return v;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [filter, setFilter] = useState<AudienceFilter>(initial);
  const kind = filter.audience_kind || 'members';

  useEffect(() => { onChange(filter); }, [filter, onChange]);

  // Live segments list (only relevant for 'segment' kind)
  const { data: segments } = useQuery({
    queryKey: ['contact-segments', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contact_segments' as any)
        .select('id, name, audience_count')
        .eq('branch_id', branchId)
        .order('name');
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!branchId && kind === 'segment',
  });

  // Resolve audience size + sample for ALL kinds via the SQL resolver
  const { data, isLoading, error } = useQuery({
    queryKey: ['campaign-audience-v2', branchId, filter],
    queryFn: async () => {
      // Members fast path keeps existing behavior so member_ids still flow through
      if (kind === 'members') {
        const r = await resolveAudienceMemberIds(branchId, filter);
        return {
          recipients: r.memberIds.length,
          sample: r.sample.map(s => s.name),
          memberIds: r.memberIds,
        };
      }
      const recs = await resolveCampaignAudience(branchId, filter);
      // Channel-aware count: skip recipients without phone (whatsapp/sms) or email
      const usable = recs.filter(r => {
        if (channel === 'email') return !!r.email;
        return !!r.phone;
      });
      return {
        recipients: usable.length,
        sample: usable.slice(0, 6).map(r => r.full_name || r.phone || r.email || '—'),
        memberIds: [] as string[],
      };
    },
    enabled: !!branchId,
    staleTime: 5_000,
    retry: false,
  });

  // Pass member ids to wizard (only meaningful for 'members' kind; non-members use the resolver path)
  useEffect(() => { onResolved(data?.memberIds || []); }, [data, onResolved]);

  const setKind = (k: AudienceKind) => setFilter({ audience_kind: k });

  return (
    <div className="space-y-5">
      {/* Audience kind picker */}
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Who should receive this?</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {KIND_OPTIONS.map(opt => {
            const active = kind === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setKind(opt.id)}
                className={`text-left rounded-2xl p-3 border-2 transition-all ${
                  active
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10 shadow-sm'
                    : 'border-border bg-card hover:border-muted-foreground/40'
                }`}
              >
                <Icon className={`h-4 w-4 mb-1.5 ${active ? 'text-violet-600' : 'text-muted-foreground'}`} />
                <p className="text-sm font-semibold text-foreground leading-tight">{opt.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-filters */}
      {kind === 'members' && (
        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Membership status</Label>
            <Select
              value={filter.member_status || filter.status || 'all'}
              onValueChange={(v) => setFilter({ ...filter, member_status: v as any, status: v as any })}
            >
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All members</SelectItem>
                <SelectItem value="active">Active members</SelectItem>
                <SelectItem value="expired">Expired members</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Fitness goal contains</Label>
            <Input
              className="rounded-xl"
              placeholder="e.g. weight loss, muscle gain"
              value={filter.goal || ''}
              onChange={(e) => setFilter({ ...filter, goal: e.target.value || null })}
            />
          </div>

          <div className="rounded-xl border border-dashed bg-muted/30 p-3 flex gap-2 text-[11px] text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
            <span>
              Looking to win back members who haven&apos;t visited in a while?
              Use the <Link to="/automations" className="underline text-violet-600">Smart Retention Nudge Engine</Link> — it runs automatically based on absence cooldowns.
            </span>
          </div>
        </div>
      )}

      {kind === 'leads' && (
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Lead status</Label>
          <div className="flex flex-wrap gap-1.5">
            {['new','contacted','qualified','trial_scheduled','negotiation','lost','converted'].map(s => {
              const selected = (filter.lead_status || []).includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    const cur = new Set(filter.lead_status || []);
                    if (cur.has(s)) cur.delete(s); else cur.add(s);
                    setFilter({ ...filter, lead_status: Array.from(cur) });
                  }}
                  className={`px-2.5 py-1 rounded-full text-[11px] border transition-all ${
                    selected
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-card border-border hover:border-muted-foreground/40 text-muted-foreground'
                  }`}
                >
                  {s.replace('_',' ')}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Leave empty to target every lead in this branch.</p>
        </div>
      )}

      {kind === 'staff' && (
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Roles</Label>
          <div className="flex flex-wrap gap-1.5">
            {STAFF_ROLES.map(r => {
              const selected = (filter.staff_roles || []).includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    const cur = new Set(filter.staff_roles || []);
                    if (cur.has(r.id)) cur.delete(r.id); else cur.add(r.id);
                    setFilter({ ...filter, staff_roles: Array.from(cur) as StaffRole[] });
                  }}
                  className={`px-2.5 py-1 rounded-full text-[11px] border transition-all ${
                    selected
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-card border-border hover:border-muted-foreground/40 text-muted-foreground'
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Leave empty to include every staff member, trainer, manager, admin and owner of this branch.</p>
        </div>
      )}

      {kind === 'contacts' && (
        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Source types</Label>
            <div className="flex flex-wrap gap-1.5">
              {(['member','lead','manual','ai'] as const).map(s => {
                const selected = (filter.source_types || []).includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      const cur = new Set(filter.source_types || []);
                      if (cur.has(s)) cur.delete(s); else cur.add(s);
                      setFilter({ ...filter, source_types: Array.from(cur) as any });
                    }}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-all ${
                      selected ? 'bg-violet-600 text-white border-violet-600' : 'bg-card border-border text-muted-foreground'
                    }`}
                  >{s}</button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Tags (comma separated)</Label>
            <Input
              className="rounded-xl"
              placeholder="vip, corporate, referral"
              value={(filter.tags || []).join(', ')}
              onChange={(e) => setFilter({ ...filter, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
            />
          </div>
        </div>
      )}

      {kind === 'mixed' && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-3 text-[11px] text-muted-foreground flex gap-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600" />
          <span>Mixed mode includes <b>all members, leads, contacts and staff</b> in this branch. Use sub-filters from individual kinds in a future release for finer control.</span>
        </div>
      )}

      {kind === 'segment' && (
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Saved segment</Label>
          <Select
            value={filter.segment_id || ''}
            onValueChange={(v) => setFilter({ audience_kind: 'segment', segment_id: v })}
          >
            <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choose a segment" /></SelectTrigger>
            <SelectContent>
              {(segments || []).map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.name} ({s.audience_count})</SelectItem>
              ))}
              {(!segments || segments.length === 0) && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No saved segments yet — create one from Contact Book.</div>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Live audience size */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-500/10 dark:to-indigo-500/10 p-5 shadow-sm shadow-violet-200/40">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-violet-600 text-white flex items-center justify-center">
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase text-muted-foreground tracking-wider">Live audience size</p>
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Counting…
              </div>
            ) : (
              <p className="text-2xl font-bold text-foreground">
                {data?.recipients ?? 0} <span className="text-sm font-normal text-muted-foreground">recipients</span>
              </p>
            )}
            {channel && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Recipients without a {channel === 'email' ? 'verified email' : 'phone number'} are skipped automatically.
              </p>
            )}
          </div>
        </div>
        {!!data?.sample?.length && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {data.sample.map((s, i) => <Badge key={i} variant="outline" className="text-[11px] rounded-full">{s}</Badge>)}
            {((data.recipients || 0) > data.sample.length) && (
              <Badge variant="outline" className="text-[11px] rounded-full">+{(data.recipients || 0) - data.sample.length} more</Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
