import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, Mail, MessageSquare, Calendar, ArrowRight, Flame, Sun, Snowflake, Send, Sparkles, GitMerge, Loader2, Clock } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leadService } from '@/services/leadService';
import { communicationService } from '@/services/communicationService';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { LeadActivityTimeline } from './LeadActivityTimeline';
import { STATUS_CONFIG, LEAD_STATUSES, TEMP_CONFIG } from './LeadFilters';
import { LeadSourceBadge } from './LeadSourceBadge';

interface LeadProfileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: any;
  onFollowup?: (lead: any) => void;
  onConvert?: (lead: any) => void;
}

export function LeadProfileDrawer({ open, onOpenChange, lead, onFollowup, onConvert }: LeadProfileDrawerProps) {
  const queryClient = useQueryClient();
  const [activityNote, setActivityNote] = useState('');
  const [activityType, setActivityType] = useState('note');
  const [scheduleSmsOpen, setScheduleSmsOpen] = useState(false);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsTime, setSmsTime] = useState('');

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => leadService.updateLeadStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      queryClient.invalidateQueries({ queryKey: ['lead-activities', lead?.id] });
      toast.success('Status updated');
    },
    onError: () => toast.error('Failed to update status'),
  });

  const updateTempMutation = useMutation({
    mutationFn: ({ id, temperature }: { id: string; temperature: string }) => leadService.updateLeadTemperature(id, temperature),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leads'] }); toast.success('Temperature updated'); },
  });

  const addActivityMutation = useMutation({
    mutationFn: (data: { lead_id: string; branch_id: string; activity_type: string; notes: string }) =>
      leadService.createActivity({ ...data, title: `${data.activity_type.charAt(0).toUpperCase() + data.activity_type.slice(1)} logged` }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-activities', lead?.id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setActivityNote('');
      toast.success('Activity logged');
    },
    onError: () => toast.error('Failed to log activity'),
  });

  const scoreMutation = useMutation({
    mutationFn: (leadId: string) => leadService.scoreLeads([leadId]),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      const result = data?.results?.[0];
      if (result?.score !== undefined) {
        toast.success(`Score: ${result.score}/100 — ${result.next_best_action || ''}`);
      } else {
        toast.error(result?.error || 'Scoring failed');
      }
    },
    onError: () => toast.error('AI scoring failed'),
  });

  const { data: duplicates = [] } = useQuery({
    queryKey: ['lead-duplicates', lead?.phone, lead?.email, lead?.id],
    queryFn: () => leadService.detectDuplicates(lead?.phone, lead?.email, lead?.id),
    enabled: !!lead && open,
  });

  const mergeMutation = useMutation({
    mutationFn: (duplicateId: string) => leadService.mergeLeads(lead.id, duplicateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-duplicates'] });
      toast.success('Leads merged');
    },
    onError: () => toast.error('Merge failed'),
  });

  const scheduleSMSMutation = useMutation({
    mutationFn: () => leadService.scheduleSMS(lead.phone, smsMessage, smsTime, lead.branch_id),
    onSuccess: () => {
      setScheduleSmsOpen(false);
      setSmsMessage('');
      setSmsTime('');
      toast.success('SMS scheduled');
    },
    onError: (e: any) => toast.error(e.message || 'Schedule failed'),
  });

  if (!lead) return null;

  const TempIcon = lead.temperature === 'hot' ? Flame : lead.temperature === 'cold' ? Snowflake : Sun;
  const tempColor = lead.temperature === 'hot' ? 'text-destructive' : lead.temperature === 'cold' ? 'text-info' : 'text-warning';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0">
        {/* Header */}
        <div className="sticky top-0 bg-background z-10 border-b px-6 pt-6 pb-4">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-lg font-bold text-primary">{lead.full_name?.charAt(0)?.toUpperCase() || '?'}</span>
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold truncate">{lead.full_name}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge className={STATUS_CONFIG[lead.status]?.color || 'bg-muted'}>
                    {STATUS_CONFIG[lead.status]?.label || lead.status}
                  </Badge>
                  <TempIcon className={`h-4 w-4 ${tempColor}`} />
                  {lead.score > 0 && (
                    <div className="flex items-center gap-1">
                      <Progress value={lead.score} className="w-12 h-1.5" />
                      <span className="text-xs text-muted-foreground">{lead.score}</span>
                    </div>
                  )}
                </div>
              </div>
            </SheetTitle>
          </SheetHeader>

          {/* Quick Actions */}
          <div className="flex gap-2 flex-wrap">
            {lead.phone && (
              <>
                <Button size="sm" variant="outline" className="rounded-lg gap-1.5" onClick={() => window.open(`tel:${lead.phone}`)}>
                  <Phone className="h-3.5 w-3.5" /> Call
                </Button>
                <Button size="sm" variant="outline" className="rounded-lg gap-1.5" onClick={() => communicationService.sendWhatsApp(lead.phone, `Hi ${lead.full_name}!`)}>
                  <MessageSquare className="h-3.5 w-3.5 text-success" /> WhatsApp
                </Button>
              </>
            )}
            {lead.email && (
              <Button size="sm" variant="outline" className="rounded-lg gap-1.5" onClick={() => {
                communicationService.sendEmailViaProvider(lead.email, `Hi ${lead.full_name}`, `<p>Hi ${lead.full_name},</p>`, lead.branch_id);
                toast.success('Email sent');
              }}>
                <Mail className="h-3.5 w-3.5" /> Email
              </Button>
            )}
            {onFollowup && (
              <Button size="sm" variant="outline" className="rounded-lg gap-1.5" onClick={() => onFollowup(lead)}>
                <Calendar className="h-3.5 w-3.5" /> Follow-up
              </Button>
            )}
            {lead.status !== 'converted' && onConvert && (
              <Button size="sm" className="rounded-lg gap-1.5" onClick={() => onConvert(lead)}>
                <ArrowRight className="h-3.5 w-3.5" /> Convert
              </Button>
            )}
            <Button size="sm" variant="outline" className="rounded-lg gap-1.5" onClick={() => scoreMutation.mutate(lead.id)} disabled={scoreMutation.isPending}>
              {scoreMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              AI Score
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <Tabs defaultValue="timeline" className="w-full">
            <TabsList className="w-full rounded-xl mb-4">
              <TabsTrigger value="timeline" className="flex-1 rounded-lg">Timeline</TabsTrigger>
              <TabsTrigger value="details" className="flex-1 rounded-lg">Details</TabsTrigger>
              <TabsTrigger value="duplicates" className="flex-1 rounded-lg">
                Dupes {duplicates.length > 0 && <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">{duplicates.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1 rounded-lg">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="space-y-4">
              {/* Quick Activity Logger */}
              <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
                <div className="flex gap-2 mb-2">
                  <Select value={activityType} onValueChange={setActivityType}>
                    <SelectTrigger className="w-28 h-8 text-xs rounded-lg"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="note">Note</SelectItem>
                      <SelectItem value="call">Call</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="sms">SMS</SelectItem>
                      <SelectItem value="visit">Visit</SelectItem>
                    </SelectContent>
                  </Select>
                  {lead.phone && (
                    <Button size="sm" variant="outline" className="h-8 text-xs rounded-lg gap-1" onClick={() => setScheduleSmsOpen(!scheduleSmsOpen)}>
                      <Clock className="h-3 w-3" /> Schedule SMS
                    </Button>
                  )}
                </div>

                {scheduleSmsOpen && lead.phone && (
                  <div className="space-y-2 mb-2 p-2 bg-muted/50 rounded-lg">
                    <Textarea value={smsMessage} onChange={(e) => setSmsMessage(e.target.value)} placeholder="SMS message..." rows={2} className="text-sm rounded-lg resize-none" />
                    <Input type="datetime-local" value={smsTime} onChange={(e) => setSmsTime(e.target.value)} className="text-sm rounded-lg" />
                    <Button size="sm" className="w-full rounded-lg" disabled={!smsMessage.trim() || !smsTime || scheduleSMSMutation.isPending}
                      onClick={() => scheduleSMSMutation.mutate()}
                    >
                      {scheduleSMSMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                      Schedule
                    </Button>
                  </div>
                )}

                <div className="flex gap-2">
                  <Textarea value={activityNote} onChange={(e) => setActivityNote(e.target.value)} placeholder="Log an activity..." rows={2} className="text-sm rounded-lg resize-none" />
                  <Button size="icon" className="shrink-0 rounded-lg h-auto" disabled={!activityNote.trim() || addActivityMutation.isPending}
                    onClick={() => addActivityMutation.mutate({ lead_id: lead.id, branch_id: lead.branch_id, activity_type: activityType, notes: activityNote.trim() })}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <LeadActivityTimeline leadId={lead.id} />
            </TabsContent>

            <TabsContent value="details" className="space-y-4">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Contact</h4>
                <div className="grid gap-2">
                  {lead.phone && <div className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4 text-muted-foreground" /><span>{lead.phone}</span></div>}
                  {lead.email && <div className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4 text-muted-foreground" /><span>{lead.email}</span></div>}
                </div>
              </div>
              {(lead.source || lead.utm_source || lead.utm_campaign) && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Attribution</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {lead.source && (
                      <div className="col-span-2 flex items-center gap-2">
                        <span className="text-muted-foreground">Source:</span>
                        <LeadSourceBadge source={lead.source} />
                      </div>
                    )}
                    {lead.utm_source && <div><span className="text-muted-foreground">UTM Source:</span> {lead.utm_source}</div>}
                    {lead.utm_medium && <div><span className="text-muted-foreground">Medium:</span> {lead.utm_medium}</div>}
                    {lead.utm_campaign && <div><span className="text-muted-foreground">Campaign:</span> {lead.utm_campaign}</div>}
                    {lead.landing_page && <div className="col-span-2"><span className="text-muted-foreground">Landing:</span> {lead.landing_page}</div>}
                    {lead.referrer_url && <div className="col-span-2"><span className="text-muted-foreground">Referrer:</span> {lead.referrer_url}</div>}
                  </div>
                </div>
              )}
              {(lead.notes || lead.goals || lead.budget) && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Notes</h4>
                  {lead.notes && <p className="text-sm bg-muted/30 rounded-lg p-3">{lead.notes}</p>}
                  {lead.goals && <div className="text-sm"><span className="text-muted-foreground">Goals:</span> {lead.goals}</div>}
                  {lead.budget && <div className="text-sm"><span className="text-muted-foreground">Budget:</span> {lead.budget}</div>}
                </div>
              )}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Timeline</h4>
                <div className="grid gap-1 text-sm">
                  <div><span className="text-muted-foreground">Created:</span> {format(new Date(lead.created_at), 'MMM dd, yyyy HH:mm')}</div>
                  {lead.first_response_at && <div><span className="text-muted-foreground">First response:</span> {format(new Date(lead.first_response_at), 'MMM dd, yyyy HH:mm')}</div>}
                  {lead.last_contacted_at && <div><span className="text-muted-foreground">Last contact:</span> {format(new Date(lead.last_contacted_at), 'MMM dd, yyyy HH:mm')}</div>}
                  {lead.converted_at && <div><span className="text-muted-foreground">Converted:</span> {format(new Date(lead.converted_at), 'MMM dd, yyyy HH:mm')}</div>}
                </div>
              </div>
              {lead.tags?.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Tags</h4>
                  <div className="flex flex-wrap gap-1">{lead.tags.map((tag: string) => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}</div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="duplicates" className="space-y-4">
              {duplicates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <GitMerge className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No duplicate leads found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{duplicates.length} potential duplicate(s) found by matching phone/email</p>
                  {duplicates.map((dup: any) => (
                    <Card key={dup.id} className="rounded-xl">
                      <CardContent className="p-3 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{dup.full_name}</p>
                          <p className="text-xs text-muted-foreground">{dup.phone || dup.email} · {dup.status}</p>
                        </div>
                        <Button size="sm" variant="outline" className="rounded-lg gap-1.5" onClick={() => mergeMutation.mutate(dup.id)} disabled={mergeMutation.isPending}>
                          <GitMerge className="h-3.5 w-3.5" /> Merge
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={lead.status} onValueChange={(s) => updateStatusMutation.mutate({ id: lead.id, status: s })}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAD_STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Temperature</Label>
                <div className="flex gap-2">
                  {TEMP_CONFIG.map(temp => {
                    const TIcon = temp.icon;
                    const isActive = lead.temperature === temp.value;
                    return (
                      <Button key={temp.value} variant={isActive ? 'default' : 'outline'} size="sm" className="rounded-lg gap-1.5 flex-1"
                        onClick={() => updateTempMutation.mutate({ id: lead.id, temperature: temp.value })}
                      >
                        <TIcon className="h-3.5 w-3.5" /> {temp.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Lead Score (0-100)</Label>
                <div className="flex items-center gap-3">
                  <Progress value={lead.score || 0} className="flex-1" />
                  <span className="text-sm font-mono w-8 text-right">{lead.score || 0}</span>
                </div>
                <Button size="sm" variant="outline" className="w-full rounded-lg gap-1.5" onClick={() => scoreMutation.mutate(lead.id)} disabled={scoreMutation.isPending}>
                  {scoreMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Refresh AI Score & Get Recommendation
                </Button>
              </div>
              {lead.status === 'lost' && lead.lost_reason && (
                <div className="space-y-2">
                  <Label>Lost Reason</Label>
                  <p className="text-sm bg-destructive/10 text-destructive rounded-lg p-3">{lead.lost_reason}</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
