import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { leadService } from '@/services/leadService';
import { supabase } from '@/integrations/supabase/client';
import { CommConsentCheckbox, COMM_CONSENT_TEXT, COMM_CONSENT_CHANNELS } from '@/components/consent/CommConsentCheckbox';
import { toast } from 'sonner';
import { Flame, Sun, Snowflake } from 'lucide-react';

export interface LeadPrefill {
  full_name?: string;
  phone?: string;
  email?: string;
  source?: string;
  notes?: string;
  preferred_contact_channel?: string;
}

interface AddLeadDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultBranchId?: string;
  prefill?: LeadPrefill;
}

const EMPTY_LEAD = {
  full_name: '',
  phone: '',
  email: '',
  source: 'walk_in',
  notes: '',
  temperature: 'warm',
  goals: '',
  budget: '',
  preferred_contact_channel: 'phone',
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
};

export function AddLeadDrawer({ open, onOpenChange, defaultBranchId, prefill }: AddLeadDrawerProps) {
  const queryClient = useQueryClient();
  const [newLead, setNewLead] = useState({ ...EMPTY_LEAD });
  const [consent, setConsent] = useState(false);

  // Apply prefill whenever the drawer opens with new data (e.g., from WhatsApp Chat).
  useEffect(() => {
    if (open && prefill) {
      setNewLead({ ...EMPTY_LEAD, ...prefill });
      setConsent(false);
    }
  }, [open, prefill]);


  const createLeadMutation = useMutation({
    mutationFn: (lead: typeof newLead) => leadService.createLead({
      full_name: lead.full_name,
      phone: lead.phone,
      email: lead.email || null,
      source: lead.source,
      notes: lead.notes || null,
      temperature: lead.temperature,
      goals: lead.goals || null,
      budget: lead.budget || null,
      preferred_contact_channel: lead.preferred_contact_channel,
      utm_source: lead.utm_source || null,
      utm_medium: lead.utm_medium || null,
      utm_campaign: lead.utm_campaign || null,
      branch_id: defaultBranchId || '',
      status: 'new',
      score: lead.temperature === 'hot' ? 70 : lead.temperature === 'warm' ? 40 : 10,
    }),
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      // Record opt-in if staff confirmed verbal consent
      if (data?.id && consent) {
        try {
          await supabase.rpc('record_consent', {
            p_subject_type: 'lead',
            p_subject_id: data.id,
            p_channels: [...COMM_CONSENT_CHANNELS],
            p_source: 'staff_drawer',
            p_consent_text: COMM_CONSENT_TEXT,
            p_action: 'grant',
          } as never);
        } catch (e) {
          console.error('record_consent failed:', e);
        }
      }
      onOpenChange(false);
      // Fire-and-forget: trigger unified lead notifications via edge function
      if (data?.id && defaultBranchId) {
        supabase.functions.invoke('notify-lead-created', {
          body: { lead_id: data.id, branch_id: defaultBranchId },
        }).catch(e => console.error('Lead notification failed:', e));
      }
      setNewLead({ ...EMPTY_LEAD });
      setConsent(false);
      toast.success('Lead added successfully');
    },
    onError: () => toast.error('Failed to add lead'),
  });

  const TEMP_OPTIONS = [
    { value: 'hot', label: 'Hot', icon: Flame, color: 'text-destructive' },
    { value: 'warm', label: 'Warm', icon: Sun, color: 'text-warning' },
    { value: 'cold', label: 'Cold', icon: Snowflake, color: 'text-info' },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add New Lead</SheetTitle>
          <SheetDescription>Create a new lead for follow-up</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="basic" className="mt-4">
          <TabsList className="w-full rounded-xl">
            <TabsTrigger value="basic" className="flex-1 rounded-lg">Basic</TabsTrigger>
            <TabsTrigger value="marketing" className="flex-1 rounded-lg">Marketing</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input
                value={newLead.full_name}
                onChange={(e) => setNewLead({ ...newLead, full_name: e.target.value })}
                placeholder="Enter full name"
              />
            </div>

            <div className="space-y-2">
              <Label>Phone *</Label>
              <PhoneInput
                value={newLead.phone}
                onChange={(value) => setNewLead({ ...newLead, phone: value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={newLead.email}
                onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                placeholder="email@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label>Temperature</Label>
              <div className="flex gap-2">
                {TEMP_OPTIONS.map(temp => {
                  const TIcon = temp.icon;
                  const isActive = newLead.temperature === temp.value;
                  return (
                    <Button
                      key={temp.value}
                      type="button"
                      variant={isActive ? 'default' : 'outline'}
                      size="sm"
                      className="rounded-lg gap-1.5 flex-1"
                      onClick={() => setNewLead({ ...newLead, temperature: temp.value })}
                    >
                      <TIcon className="h-3.5 w-3.5" />
                      {temp.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Source</Label>
              <Select value={newLead.source} onValueChange={(v) => setNewLead({ ...newLead, source: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="walk_in">Walk-in</SelectItem>
                  <SelectItem value="website">Website</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="whatsapp_api">WhatsApp</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="meta_ad">Meta Ads</SelectItem>
                  <SelectItem value="google_ads">Google Ads</SelectItem>
                  <SelectItem value="advertisement">Advertisement</SelectItem>
                  <SelectItem value="phone">Phone Call</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Contact Preference</Label>
              <Select value={newLead.preferred_contact_channel} onValueChange={(v) => setNewLead({ ...newLead, preferred_contact_channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Goals</Label>
              <Input
                value={newLead.goals}
                onChange={(e) => setNewLead({ ...newLead, goals: e.target.value })}
                placeholder="Weight loss, muscle gain..."
              />
            </div>

            <div className="space-y-2">
              <Label>Budget</Label>
              <Input
                value={newLead.budget}
                onChange={(e) => setNewLead({ ...newLead, budget: e.target.value })}
                placeholder="e.g. ₹3000-5000/month"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={newLead.notes}
                onChange={(e) => setNewLead({ ...newLead, notes: e.target.value })}
                placeholder="Any additional notes..."
                rows={3}
              />
            </div>
          </TabsContent>

          <TabsContent value="marketing" className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">Optional UTM parameters for marketing attribution</p>
            <div className="space-y-2">
              <Label>UTM Source</Label>
              <Input
                value={newLead.utm_source}
                onChange={(e) => setNewLead({ ...newLead, utm_source: e.target.value })}
                placeholder="google, facebook, instagram..."
              />
            </div>
            <div className="space-y-2">
              <Label>UTM Medium</Label>
              <Input
                value={newLead.utm_medium}
                onChange={(e) => setNewLead({ ...newLead, utm_medium: e.target.value })}
                placeholder="cpc, social, email..."
              />
            </div>
            <div className="space-y-2">
              <Label>UTM Campaign</Label>
              <Input
                value={newLead.utm_campaign}
                onChange={(e) => setNewLead({ ...newLead, utm_campaign: e.target.value })}
                placeholder="summer_promo, new_year..."
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 px-1">
          <CommConsentCheckbox
            checked={consent}
            onCheckedChange={setConsent}
            id="add-lead-consent"
          />
          <p className="text-[11px] text-muted-foreground mt-1.5 pl-7">
            For walk-ins, tick only after confirming verbal consent.
          </p>
        </div>

        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => createLeadMutation.mutate(newLead)}
            disabled={!newLead.full_name || !newLead.phone || createLeadMutation.isPending}
          >
            {createLeadMutation.isPending ? 'Adding...' : 'Add Lead'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
