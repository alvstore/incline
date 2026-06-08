import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Bell, MessageSquare, Mail, Smartphone, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getMemberCommPreferences,
  upsertMemberCommPreferences,
  type MemberCommPreferences,
} from '@/services/preferencesService';

const DEFAULTS: Omit<MemberCommPreferences, 'member_id' | 'branch_id'> = {
  whatsapp_enabled: true,
  sms_enabled: true,
  email_enabled: true,
  quiet_hours_start: null,
  quiet_hours_end: null,
  timezone: 'Asia/Kolkata',
  membership_reminders: true,
  payment_receipts: true,
  class_notifications: true,
  announcements: true,
  retention_nudges: true,
  review_requests: true,
  marketing: true,
};

interface Props {
  memberId: string;
  branchId: string;
}

export function CommunicationPreferences({ memberId, branchId }: Props) {
  const qc = useQueryClient();
  const queryKey = ['member-comm-prefs', memberId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getMemberCommPreferences(memberId),
    enabled: !!memberId,
  });

  const [draft, setDraft] = useState<typeof DEFAULTS>(DEFAULTS);

  useEffect(() => {
    if (data) {
      const { member_id: _m, branch_id: _b, ...rest } = data;
      setDraft({ ...DEFAULTS, ...rest });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => upsertMemberCommPreferences(memberId, branchId, draft),
    onSuccess: () => {
      toast.success('Communication preferences updated');
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to save preferences'),
  });

  if (isLoading) {
    return (
      <Card className="rounded-2xl shadow-lg shadow/50">
        <CardContent className="p-8 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading preferences…
        </CardContent>
      </Card>
    );
  }

  const set = <K extends keyof typeof DEFAULTS>(k: K, v: (typeof DEFAULTS)[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Card className="rounded-2xl shadow-lg shadow/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Bell className="w-5 h-5 text-primary" />
          Communication Preferences
        </CardTitle>
        <CardDescription>
          Choose how we reach out. Receipts, security alerts and other transactional messages are always sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Channel kill switches */}
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Channels</h3>
          <div className="space-y-3">
            <ChannelToggle
              icon={<MessageSquare className="w-4 h-4" />}
              label="WhatsApp"
              checked={draft.whatsapp_enabled}
              onChange={(v) => set('whatsapp_enabled', v)}
            />
            <ChannelToggle
              icon={<Smartphone className="w-4 h-4" />}
              label="SMS"
              checked={draft.sms_enabled}
              onChange={(v) => set('sms_enabled', v)}
            />
            <ChannelToggle
              icon={<Mail className="w-4 h-4" />}
              label="Email"
              checked={draft.email_enabled}
              onChange={(v) => set('email_enabled', v)}
            />
          </div>
        </section>

        {/* Category opt-outs */}
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Topics</h3>
          <div className="space-y-3">
            <CategoryToggle label="Membership reminders" checked={draft.membership_reminders} onChange={(v) => set('membership_reminders', v)} />
            <CategoryToggle label="Payment receipts" checked={draft.payment_receipts} onChange={(v) => set('payment_receipts', v)} />
            <CategoryToggle label="Class & booking updates" checked={draft.class_notifications} onChange={(v) => set('class_notifications', v)} />
            <CategoryToggle label="Announcements" checked={draft.announcements} onChange={(v) => set('announcements', v)} />
            <CategoryToggle label="Re-engagement nudges" checked={draft.retention_nudges} onChange={(v) => set('retention_nudges', v)} />
            <CategoryToggle label="Feedback / review requests" checked={draft.review_requests} onChange={(v) => set('review_requests', v)} />
            <CategoryToggle label="Promotional offers" checked={draft.marketing} onChange={(v) => set('marketing', v)} />
          </div>
        </section>

        {/* Quiet hours */}
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quiet hours</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Non-urgent messages during this window are queued and delivered after.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qh-start" className="text-xs">From</Label>
              <Input
                id="qh-start"
                type="time"
                value={draft.quiet_hours_start ?? ''}
                onChange={(e) => set('quiet_hours_start', e.target.value || null)}
              />
            </div>
            <div>
              <Label htmlFor="qh-end" className="text-xs">To</Label>
              <Input
                id="qh-end"
                type="time"
                value={draft.quiet_hours_end ?? ''}
                onChange={(e) => set('quiet_hours_end', e.target.value || null)}
              />
            </div>
          </div>
        </section>

        <div className="flex justify-end pt-2">
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="bg-primary hover:bg-primary"
          >
            {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save preferences
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelToggle({
  icon, label, checked, onChange,
}: { icon: React.ReactNode; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm font-medium text-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={`Toggle ${label}`} />
    </div>
  );
}

function CategoryToggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between text-sm text-foreground">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={`Toggle ${label}`} />
    </div>
  );
}
