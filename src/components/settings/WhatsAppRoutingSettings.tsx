import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Phone, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBranchContext } from '@/contexts/BranchContext';
import { toast } from 'sonner';

export function WhatsAppRoutingSettings() {
  const { user } = useAuth();
  const { effectiveBranchId } = useBranchContext();
  const [phone, setPhone] = useState('');
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !effectiveBranchId) return;
    setLoading(true);
    supabase.from('staff_whatsapp_routing')
      .select('personal_phone, is_available')
      .eq('user_id', user.id).eq('branch_id', effectiveBranchId).maybeSingle()
      .then(({ data }) => {
        setPhone(data?.personal_phone || '');
        setAvailable(data?.is_available ?? true);
        setLoading(false);
      });
  }, [user, effectiveBranchId]);

  const save = async () => {
    if (!user || !effectiveBranchId) return;
    if (!phone.match(/^[0-9]{10,15}$/)) {
      toast.error('Enter a valid phone number (digits only, no +)');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('staff_whatsapp_routing').upsert({
      user_id: user.id,
      branch_id: effectiveBranchId,
      personal_phone: phone,
      is_available: available,
    }, { onConflict: 'branch_id,user_id' });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success('WhatsApp routing saved');
  };

  return (
    <Card className="rounded-2xl shadow-md shadow-slate-200/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="h-4 w-4 text-violet-600" /> My WhatsApp Routing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          We'll ping your personal WhatsApp with a deep link to the shared inbox when:
        </p>
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
          <li>the AI escalates a chat (member asks for a manager, complains, or the bot can't help),</li>
          <li>a teammate clicks <span className="font-medium">Take over</span> in the inbox, or</li>
          <li>a new member completes registration.</li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Replies still go through the business number — Meta doesn't allow transferring a conversation to a different phone.
        </p>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-violet-600" /></div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Personal phone (10–15 digits)</Label>
              <Input
                className="rounded-xl"
                placeholder="9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
              <div>
                <p className="font-medium text-sm">Available for handoff</p>
                <p className="text-xs text-muted-foreground">Toggle off when you're unavailable</p>
              </div>
              <Switch checked={available} onCheckedChange={setAvailable} />
            </div>
            <Button onClick={save} disabled={saving} className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
