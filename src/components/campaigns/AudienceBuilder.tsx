import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Users, UserPlus, Briefcase, Contact2, Layers, Bookmark, Info,
  UserMinus, FileSpreadsheet, MessageCircle, Snowflake,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  resolveAudienceMemberIds,
  getAudienceBreakdown,
  type AudienceFilter,
  type AudienceBreakdown,
  type AudienceKind,
  type StaffRole,
} from '@/services/campaignService';

interface Props {
  branchId: string;
  value: AudienceFilter;
  onChange: (filter: AudienceFilter) => void;
  onResolved: (memberIds: string[]) => void;
  onBreakdown?: (b: AudienceBreakdown | null) => void;
  channel?: 'whatsapp' | 'email' | 'sms';
}

const KIND_OPTIONS: { id: AudienceKind; label: string; desc: string; icon: any }[] = [
  { id: 'members',    label: 'Members',          desc: 'Gym members in this branch',        icon: Users },
  { id: 'leads',      label: 'Leads',            desc: 'Active prospects from CRM',         icon: UserPlus },
  { id: 'lost_leads', label: 'Lost leads',       desc: 'Status=lost or no contact 60d+',    icon: UserMinus },
  { id: 'contacts',   label: 'All contacts',     desc: 'Full contact book',                 icon: Contact2 },
  { id: 'staff',      label: 'Staff',            desc: 'Owners, managers, staff, trainers', icon: Briefcase },
  { id: 'mixed',      label: 'Mixed',            desc: 'Members + leads + contacts',        icon: Layers },
  { id: 'segment',    label: 'Saved segment',    desc: 'Reuse a saved audience',            icon: Bookmark },
  { id: 'csv_import', label: 'CSV / Paste',      desc: 'One-shot list (phone,name)',        icon: FileSpreadsheet },
];

const STAFF_ROLES: { id: StaffRole; label: string }[] = [
  { id: 'owner',   label: 'Owner' },
  { id: 'admin',   label: 'Admin' },
  { id: 'manager', label: 'Manager' },
  { id: 'staff',   label: 'Staff' },
  { id: 'trainer', label: 'Trainer' },
];

function parseCsv(raw: string): Array<{ name?: string; phone: string; email?: string }> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,\t;]/).map((p) => p.trim());
      // try to detect: phone is the part with digits
      const phone = parts.find((p) => /\+?\d[\d\s-]{6,}/.test(p)) || parts[0];
      const email = parts.find((p) => /@/.test(p));
      const name = parts.find((p) => p !== phone && p !== email);
      return { phone: phone.replace(/\s+/g, ''), name, email };
    })
    .filter((r) => !!r.phone);
}

export function AudienceBuilder({ branchId, value, onChange, onResolved, onBreakdown, channel }: Props) {
  const initial: AudienceFilter = useMemo(() => {
    const v = { ...value };
    if (!v.audience_kind) v.audience_kind = 'members';
    if (v.audience_kind === 'members' && !v.member_status && v.status) {
      v.member_status = v.status === 'lead' ? 'all' : v.status;
    }
    return v;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [filter, setFilter] = useState<AudienceFilter>(initial);
  const [csvText, setCsvText] = useState<string>(
    (initial.csv_recipients || []).map((r) => `${r.phone},${r.name || ''}`).join('\n'),
  );
  const kind = filter.audience_kind || 'members';

  useEffect(() => { onChange(filter); }, [filter, onChange]);

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

  const { data: breakdown, isLoading, error } = useQuery({
    queryKey: ['campaign-audience-breakdown', branchId, filter, channel],
    queryFn: async () => {
      const b = await getAudienceBreakdown(branchId, filter);
      // channel-aware: drop recipients without phone (whatsapp/sms) or email
      // Approximation: when channel=email and filter doesn't filter by email,
      // we leave the count as-is; dispatcher will skip rowless ones.
      return b;
    },
    enabled: !!branchId,
    staleTime: 5_000,
    retry: false,
  });

  // Members fast-path for memberIds (used by send-broadcast)
  const { data: memberData } = useQuery({
    queryKey: ['campaign-member-ids', branchId, filter],
    queryFn: () => resolveAudienceMemberIds(branchId, filter),
    enabled: !!branchId && kind === 'members',
    staleTime: 5_000,
  });

  useEffect(() => { onResolved(memberData?.memberIds || []); }, [memberData, onResolved]);
  useEffect(() => { onBreakdown?.(breakdown ?? null); }, [breakdown, onBreakdown]);

  const setKind = (k: AudienceKind) => {
    if (k === 'csv_import') {
      setFilter({ audience_kind: k, csv_recipients: parseCsv(csvText) });
    } else {
      setFilter({ audience_kind: k });
    }
  };

  const sourceColor = (src: string) => {
    switch (src) {
      case 'member': return 'bg-violet-100 text-violet-700';
      case 'lead': return 'bg-amber-100 text-amber-700';
      case 'lost_lead': return 'bg-slate-200 text-slate-700';
      case 'contact': return 'bg-emerald-100 text-emerald-700';
      case 'csv': return 'bg-blue-100 text-blue-700';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Who should receive this?</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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

      {/* Kind-specific filters */}
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
            {['new','contacted','qualified','trial_scheduled','negotiation','converted'].map(s => {
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
          <p className="text-[11px] text-muted-foreground mt-2">Leave empty to target every active lead. Lost leads are excluded — pick "Lost leads" instead.</p>
        </div>
      )}

      {kind === 'lost_leads' && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-3 flex gap-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-rose-600" />
          <span>Targets leads marked <b>lost</b> or any lead with no contact in the last <b>60 days</b>. These are cold by definition — you'll need an APPROVED Meta template on the Message step.</span>
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
        </div>
      )}

      {kind === 'contacts' && (
        <div className="space-y-4">
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
          <span>Includes <b>all members, leads and contacts</b> in this branch. Use sub-filters from individual kinds in a future release for finer control.</span>
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

      {kind === 'csv_import' && (
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1 block">Paste recipients</Label>
          <Textarea
            className="rounded-xl font-mono text-xs"
            rows={6}
            placeholder={'+919876543210, Aman Verma\n+919812345678, Priya Singh\n+918888888888'}
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setFilter({ audience_kind: 'csv_import', csv_recipients: parseCsv(e.target.value) });
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            One per line. Format: <code>phone, name, email</code>. Email is optional. CSV imports are always treated as <b>cold</b> — an APPROVED Meta template is required.
          </p>
        </div>
      )}

      {/* Live audience breakdown */}
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
            ) : error ? (
              <p className="text-sm font-semibold text-red-600">
                Audience query failed — {(error as Error).message}
              </p>
            ) : (
              <p className="text-2xl font-bold text-foreground">
                {breakdown?.total ?? 0} <span className="text-sm font-normal text-muted-foreground">recipients</span>
              </p>
            )}
            {channel && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Recipients without a {channel === 'email' ? 'verified email' : 'phone number'} are skipped automatically.
              </p>
            )}
          </div>
        </div>

        {!!breakdown && breakdown.total > 0 && (
          <>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-2.5 flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-emerald-600" />
                <div>
                  <p className="text-base font-bold text-emerald-700">{breakdown.in_window}</p>
                  <p className="text-[10px] uppercase text-emerald-700/80">In 24h window · freeform OK</p>
                </div>
              </div>
              <div className={`rounded-xl p-2.5 flex items-center gap-2 ${breakdown.cold > 0 ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-muted/50'}`}>
                <Snowflake className={`h-4 w-4 ${breakdown.cold > 0 ? 'text-amber-600' : 'text-muted-foreground'}`} />
                <div>
                  <p className={`text-base font-bold ${breakdown.cold > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>{breakdown.cold}</p>
                  <p className="text-[10px] uppercase text-amber-700/80">Cold · needs Meta template</p>
                </div>
              </div>
            </div>

            {Object.keys(breakdown.by_source).length > 1 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {Object.entries(breakdown.by_source).map(([src, n]) => (
                  <span key={src} className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${sourceColor(src)}`}>
                    {src.replace('_', ' ')} · {n}
                  </span>
                ))}
              </div>
            )}

            {!!breakdown.sample.length && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {breakdown.sample.map((s, i) => (
                  <Badge key={i} variant="outline" className="text-[11px] rounded-full">{s.name}</Badge>
                ))}
                {(breakdown.total > breakdown.sample.length) && (
                  <Badge variant="outline" className="text-[11px] rounded-full">+{breakdown.total - breakdown.sample.length} more</Badge>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
