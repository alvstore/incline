import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { useBranchContext } from '@/contexts/BranchContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getProviderSchema, getProviderDisplayName, getWebhookInfoForProvider, getDefaultConfigForProvider, type ProviderFieldDef } from '@/config/providerSchemas';
import { 
  CreditCard, MessageSquare, Mail, Phone, Webhook, Copy,
  Settings, CheckCircle, XCircle, Globe, Instagram, Facebook, MessageCircle, Activity
} from 'lucide-react';
import { WebhookActivityPanel, GatewayLastReceivedBadge } from '@/components/integrations/WebhookActivityPanel';

type IntegrationType = 'payment_gateway' | 'sms' | 'email' | 'whatsapp' | 'google_business' | 'instagram' | 'messenger';

const PAYMENT_PROVIDERS = [
  { id: 'razorpay', name: 'Razorpay', abbr: 'Rp', bgColor: 'bg-blue-600', textColor: 'text-white' },
  { id: 'phonepe', name: 'PhonePe', abbr: 'Pe', bgColor: 'bg-purple-600', textColor: 'text-white' },
  { id: 'ccavenue', name: 'CCAvenue', abbr: 'CC', bgColor: 'bg-emerald-600', textColor: 'text-white' },
  { id: 'payu', name: 'PayU', abbr: 'PU', bgColor: 'bg-amber-500', textColor: 'text-white' },
];

const SMS_PROVIDERS = [
  { id: 'msg91', name: 'MSG91', description: 'Indian SMS with DLT support' },
  { id: 'gupshup', name: 'Gupshup', description: 'Enterprise SMS platform' },
  { id: 'twilio', name: 'Twilio', description: 'Global SMS provider' },
  { id: 'custom', name: 'Custom API', description: 'Your own SMS API' },
];

const EMAIL_PROVIDERS = [
  { id: 'smtp', name: 'Custom SMTP', description: 'Use your own SMTP server' },
  { id: 'sendgrid', name: 'SendGrid', description: 'Email API service' },
  { id: 'ses', name: 'Amazon SES', description: 'AWS email service' },
  { id: 'mailgun', name: 'Mailgun', description: 'Developer email platform' },
];

const WHATSAPP_PROVIDERS = [
  { id: 'meta_cloud', name: 'Meta Cloud API', description: 'Direct WhatsApp Cloud API (recommended)' },
  { id: 'wati', name: 'WATI', description: 'Official WhatsApp API' },
  { id: 'interakt', name: 'Interakt', description: 'WhatsApp Business API' },
  { id: 'gupshup', name: 'Gupshup', description: 'WhatsApp messaging' },
  { id: 'aisensy', name: 'AiSensy', description: 'WhatsApp marketing platform' },
  { id: 'custom', name: 'Custom API', description: 'Your own WhatsApp API' },
];

const INSTAGRAM_PROVIDERS = [
  { id: 'instagram_meta', name: 'Instagram Direct (Meta)', description: 'Receive and reply to Instagram DMs' },
];

const MESSENGER_PROVIDERS = [
  { id: 'messenger_meta', name: 'Facebook Messenger (Meta)', description: 'Receive and reply to Messenger messages' },
];

const GOOGLE_PROVIDERS = [
  { id: 'google_business', name: 'Google Business Profile', description: 'Track Google Reviews & reply (review requests use the per-branch link)' },
];

const IntegrationCard = ({ title, description, icon: Icon, activeCount, children }: { title: string; description: string; icon: any; activeCount: number; children: React.ReactNode }) => (
  <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            {title}
          </CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        <Badge variant={activeCount > 0 ? 'default' : 'secondary'} className="rounded-full px-2.5 py-1">
          {activeCount} active
        </Badge>
      </div>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

export default function IntegrationsPage() {
  const { selectedBranch, branchFilter } = useBranchContext();
  const [configSheet, setConfigSheet] = useState<{
    open: boolean;
    type: IntegrationType;
    provider: string;
    existing?: any;
  }>({ open: false, type: 'payment_gateway', provider: '' });
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'payment';
  const [activeTab, setActiveTab] = useState(initialTab === 'webhooks' ? 'payment' : initialTab);
  useEffect(() => {
    const t = searchParams.get('tab');
    // Legacy redirect: /integrations?tab=webhooks → /integrations/webhooks
    if (t === 'webhooks') {
      window.location.replace('/integrations/webhooks');
      return;
    }
    if (t && t !== activeTab) setActiveTab(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations', selectedBranch],
    queryFn: async () => {
      let query = supabase
        .from('integration_settings')
        .select('*')
        .order('created_at', { ascending: false });

      if (selectedBranch !== 'all') {
        query = query.eq('branch_id', selectedBranch);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const getIntegrationsByType = (type: IntegrationType) => integrations.filter((i: any) => i.integration_type === type);
  const activeCount = (type: IntegrationType) => getIntegrationsByType(type).filter((i: any) => i.is_active).length;

  const openConfig = (type: IntegrationType, provider: string) => {
    const existing = integrations.find((i: any) => i.integration_type === type && i.provider === provider);
    setConfigSheet({ open: true, type, provider, existing });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
            <p className="text-muted-foreground mt-1">Configure payment, SMS, email, and social messaging channels.</p>
          </div>
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/integrations/webhooks">
              <Activity className="mr-2 h-4 w-4" />
              View Webhook Activity
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 grid-cols-2 xl:grid-cols-5">
          <StatCard title="Payment" value={activeCount('payment_gateway')} icon={CreditCard} variant={activeCount('payment_gateway') > 0 ? 'success' : 'default'} />
          <StatCard title="SMS" value={activeCount('sms')} icon={Phone} variant={activeCount('sms') > 0 ? 'success' : 'default'} />
          <StatCard title="Email" value={activeCount('email')} icon={Mail} variant={activeCount('email') > 0 ? 'success' : 'default'} />
          <StatCard title="WhatsApp" value={activeCount('whatsapp')} icon={MessageSquare} variant={activeCount('whatsapp') > 0 ? 'success' : 'default'} />
          <StatCard title="Google" value={activeCount('google_business')} icon={Globe} variant={activeCount('google_business') > 0 ? 'success' : 'default'} />
        </div>

        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSearchParams(v === 'payment' ? {} : { tab: v }, { replace: true }); }} className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap gap-1 rounded-2xl bg-muted/70 p-1.5">
            <TabsTrigger value="payment" className="rounded-xl px-4">Payment</TabsTrigger>
            <TabsTrigger value="sms" className="rounded-xl px-4">SMS</TabsTrigger>
            <TabsTrigger value="email" className="rounded-xl px-4">Email</TabsTrigger>
            <TabsTrigger value="whatsapp" className="rounded-xl px-4 gap-1.5"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</TabsTrigger>
            <TabsTrigger value="instagram" className="rounded-xl px-4 gap-1.5"><Instagram className="h-3.5 w-3.5" />Instagram</TabsTrigger>
            <TabsTrigger value="messenger" className="rounded-xl px-4 gap-1.5"><Facebook className="h-3.5 w-3.5" />Messenger</TabsTrigger>
            <TabsTrigger value="google" className="rounded-xl px-4 gap-1.5"><Globe className="h-3.5 w-3.5" />Google</TabsTrigger>
          </TabsList>

          <TabsContent value="payment" className="space-y-4">
            <IntegrationCard title="Payment Gateways" description="Connect gateways with webhook support and automatic reconciliation." icon={CreditCard} activeCount={activeCount('payment_gateway')}>
              <div className="grid gap-4 md:grid-cols-2">
                {PAYMENT_PROVIDERS.map((provider) => {
                  const config = getIntegrationsByType('payment_gateway').find((i: any) => i.provider === provider.id);
                  return (
                    <Card key={provider.id} className="border-border/60 bg-gradient-to-br from-background to-muted/30">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-11 h-11 rounded-2xl ${provider.bgColor} ${provider.textColor} flex items-center justify-center font-semibold shadow-sm`}>{provider.abbr}</div>
                            <div>
                              <h3 className="font-semibold">{provider.name}</h3>
                              <p className="text-sm text-muted-foreground">{config?.is_active ? 'Active' : 'Not configured'}</p>
                            </div>
                          </div>
                          <Badge variant={config?.is_active ? 'default' : 'secondary'} className="rounded-full">
                            {config?.is_active ? <CheckCircle className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
                            {config?.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <Button className="mt-4 w-full rounded-xl" variant={config?.is_active ? 'outline' : 'default'} onClick={() => openConfig('payment_gateway', provider.id)}>
                          <Settings className="mr-2 h-4 w-4" />{config ? 'Configure' : 'Setup'}
                        </Button>
                        <GatewayLastReceivedBadge gateway={provider.id} branchId={branchFilter} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </IntegrationCard>
          </TabsContent>

          {/* Webhooks moved to dedicated /integrations/webhooks page */}

          <TabsContent value="sms" className="space-y-4">
            <IntegrationCard title="SMS Providers" description="Configure DLT-ready SMS providers for transactional and promotional messaging." icon={Phone} activeCount={activeCount('sms')}>
              <div className="grid gap-4 md:grid-cols-2">
                {SMS_PROVIDERS.map((provider) => {
                  const config = getIntegrationsByType('sms').find((i: any) => i.provider === provider.id);
                  return (
                    <Card key={provider.id} className="border-border/60">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{provider.name}</h3>
                            <p className="text-sm text-muted-foreground">{provider.description}</p>
                          </div>
                          <Badge variant={config?.is_active ? 'default' : 'secondary'} className="rounded-full">{config?.is_active ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <Button className="mt-4 w-full rounded-xl" variant="outline" onClick={() => openConfig('sms', provider.id)}><Settings className="mr-2 h-4 w-4" />Configure</Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </IntegrationCard>
          </TabsContent>

          <TabsContent value="email" className="space-y-4">
            <IntegrationCard title="Email Providers" description="Send receipts, invoices, alerts, and automated email flows." icon={Mail} activeCount={activeCount('email')}>
              <div className="grid gap-4 md:grid-cols-2">
                {EMAIL_PROVIDERS.map((provider) => {
                  const config = getIntegrationsByType('email').find((i: any) => i.provider === provider.id);
                  return (
                    <Card key={provider.id} className="border-border/60">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{provider.name}</h3>
                            <p className="text-sm text-muted-foreground">{provider.description}</p>
                          </div>
                          <Badge variant={config?.is_active ? 'default' : 'secondary'} className="rounded-full">{config?.is_active ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <Button className="mt-4 w-full rounded-xl" variant="outline" onClick={() => openConfig('email', provider.id)}><Settings className="mr-2 h-4 w-4" />Configure</Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </IntegrationCard>
          </TabsContent>

          <TabsContent value="whatsapp" className="space-y-4">
            <IntegrationCard title="WhatsApp" description="Connect messaging providers for chat and automation." icon={MessageSquare} activeCount={activeCount('whatsapp')}>
              <div className="grid gap-4 md:grid-cols-2">
                {WHATSAPP_PROVIDERS.map((provider) => {
                  const config = getIntegrationsByType('whatsapp').find((i: any) => i.provider === provider.id);
                  return (
                    <Card key={provider.id} className="border-border/60">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{provider.name}</h3>
                            <p className="text-sm text-muted-foreground">{provider.description}</p>
                          </div>
                          <Badge variant={config?.is_active ? 'default' : 'secondary'} className="rounded-full">{config?.is_active ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <Button className="mt-4 w-full rounded-xl" variant="outline" onClick={() => openConfig('whatsapp', provider.id)}><Settings className="mr-2 h-4 w-4" />Configure</Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </IntegrationCard>
          </TabsContent>

          <TabsContent value="instagram" className="space-y-4">
            <IntegrationCard title="Instagram Direct Messages" description="Receive and reply to Instagram DMs through the unified inbox." icon={Instagram} activeCount={activeCount('instagram')}>
              <div className="grid gap-4 md:grid-cols-2">
                {INSTAGRAM_PROVIDERS.map((provider) => {
                  const config = getIntegrationsByType('instagram').find((i: any) => i.provider === provider.id);
                  return (
                    <Card key={provider.id} className="border-border/60">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{provider.name}</h3>
                            <p className="text-sm text-muted-foreground">{provider.description}</p>
                          </div>
                          <Badge variant={config?.is_active ? 'default' : 'secondary'} className="rounded-full">{config?.is_active ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <Button className="mt-4 w-full rounded-xl" variant="outline" onClick={() => openConfig('instagram', provider.id)}><Settings className="mr-2 h-4 w-4" />Configure</Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </IntegrationCard>
          </TabsContent>

          <TabsContent value="messenger" className="space-y-4">
            <IntegrationCard
              title="Facebook Messenger"
              description="Receive and reply to Facebook Messenger conversations through the unified inbox."
              icon={Facebook}
              activeCount={getIntegrationsByType('messenger' as IntegrationType).filter((i: any) => i.is_active).length}
            >
              <div className="grid gap-4 md:grid-cols-2">
                {MESSENGER_PROVIDERS.map((provider) => {
                  const config = getIntegrationsByType('messenger' as IntegrationType).find((i: any) => i.provider === provider.id);
                  return (
                    <Card key={provider.id} className="border-border/60">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{provider.name}</h3>
                            <p className="text-sm text-muted-foreground">{provider.description}</p>
                          </div>
                          <Badge variant={config?.is_active ? 'default' : 'secondary'} className="rounded-full">{config?.is_active ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <Button className="mt-4 w-full rounded-xl" variant="outline" onClick={() => openConfig('messenger' as IntegrationType, provider.id)}>
                          <Settings className="mr-2 h-4 w-4" />Configure
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </IntegrationCard>
          </TabsContent>

          <TabsContent value="google" className="space-y-4">
            <IntegrationCard title="Google Business" description="Sync reviews and manage Google Business profile settings." icon={Globe} activeCount={activeCount('google_business')}>
              <div className="grid gap-4 md:grid-cols-2">
                {GOOGLE_PROVIDERS.map((provider) => {
                  const config = getIntegrationsByType('google_business').find((i: any) => i.provider === provider.id);
                  return (
                    <Card key={provider.id} className="border-border/60">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{provider.name}</h3>
                            <p className="text-sm text-muted-foreground">{provider.description}</p>
                          </div>
                          <Badge variant={config?.is_active ? 'default' : 'secondary'} className="rounded-full">{config?.is_active ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <Button className="mt-4 w-full rounded-xl" variant="outline" onClick={() => openConfig('google_business', provider.id)}><Settings className="mr-2 h-4 w-4" />Configure</Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </IntegrationCard>
          </TabsContent>
        </Tabs>

        <IntegrationConfigSheet
          {...configSheet}
          onOpenChange={(open) => setConfigSheet({ ...configSheet, open })}
          branchId={branchFilter}
        />
      </div>
    </AppLayout>
  );
}

function IntegrationConfigSheet({ open, onOpenChange, type, provider, existing, branchId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: IntegrationType;
  provider: string;
  existing?: any;
  branchId?: string;
}) {
  const [isActive, setIsActive] = useState(existing?.is_active || false);
  const [config, setConfig] = useState<Record<string, string>>(existing?.config || {});
  const [credentials, setCredentials] = useState<Record<string, string>>(existing?.credentials || {});
  const [touchedCredentials, setTouchedCredentials] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();

  useEffect(() => {
    setIsActive(existing?.is_active || false);
    setConfig({
      ...getDefaultConfigForProvider(type, provider),
      ...(existing?.config || {}),
    });
    setCredentials(existing?.credentials || {});
    setTouchedCredentials({});
  }, [existing, open, type, provider]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error('Please select a specific branch');

      // Merge: keep stored secrets when user did not edit them this session.
      const existingCreds: Record<string, string> = (existing?.credentials as any) || {};
      const mergedCredentials: Record<string, string> = { ...existingCreds };
      for (const [k, v] of Object.entries(credentials)) {
        const cleanValue = typeof v === 'string' ? v.trim() : v;
        if (touchedCredentials[k]) mergedCredentials[k] = cleanValue;
        else if (!(k in existingCreds) && cleanValue) mergedCredentials[k] = cleanValue;
      }

      const googleOAuthChanged = type === 'google_business' && provider === 'google_business' && (
        (touchedCredentials.client_id && mergedCredentials.client_id !== existingCreds.client_id) ||
        touchedCredentials.client_secret
      );
      if (googleOAuthChanged) {
        delete mergedCredentials.access_token;
        delete mergedCredentials.refresh_token;
        delete mergedCredentials.token_expires_at;
        delete mergedCredentials.scope;
      }

      const payload = {
        branch_id: branchId,
        integration_type: type,
        provider,
        is_active: isActive,
        config,
        credentials: mergedCredentials,
      };
      if (existing?.id) {
        const { error } = await supabase.from('integration_settings').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('integration_settings').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Configuration saved');
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      onOpenChange(false);
    },
    onError: (error: any) => toast.error(error.message || 'Failed to save'),
  });

  const schema = getProviderSchema(type, provider);
  const configFields = schema.filter(f => f.section === 'config');
  const credentialFields = schema.filter(f => f.section === 'credentials');
  const webhookInfo = getWebhookInfoForProvider(type, provider);
  const displayName = getProviderDisplayName(type, provider);

  const renderField = (field: ProviderFieldDef, values: Record<string, string>, setter: (v: Record<string, string>) => void) => {
    if (field.type === 'select' && field.options) {
      return (
        <div key={field.key} className="space-y-2">
          <Label>{field.label}</Label>
          <Select value={values[field.key] || field.options[0]?.value || ''} onValueChange={(v) => {
            setter({ ...values, [field.key]: v });
            if (field.section === 'credentials') setTouchedCredentials((p) => ({ ...p, [field.key]: true }));
          }}>
            <SelectTrigger><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
            <SelectContent>
              {field.options.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      );
    }
    if (field.type === 'password' && field.section === 'credentials') {
      const hasStored = !!(existing?.credentials || {})[field.key];
      const isTouched = !!touchedCredentials[field.key];
      return (
        <div key={field.key} className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{field.label}</Label>
            {hasStored && !isTouched && (
              <Badge variant="outline" className="text-[10px] gap-1 rounded-full">
                <CheckCircle className="h-3 w-3 text-green-600" /> Saved
              </Badge>
            )}
          </div>
          <Input
            type="password"
            autoComplete="new-password"
            value={isTouched ? (values[field.key] || '') : ''}
            onChange={(e) => {
              setter({ ...values, [field.key]: e.target.value });
              setTouchedCredentials((p) => ({ ...p, [field.key]: true }));
            }}
            placeholder={hasStored ? '•••••••• (saved — leave blank to keep)' : field.placeholder}
          />
        </div>
      );
    }
    return (
      <div key={field.key} className="space-y-2">
        <Label>{field.label}</Label>
        <Input
          type={field.type === 'password' ? 'password' : 'text'}
          value={values[field.key] || ''}
          onChange={(e) => {
            setter({ ...values, [field.key]: e.target.value });
            if (field.section === 'credentials') setTouchedCredentials((p) => ({ ...p, [field.key]: true }));
          }}
          placeholder={field.placeholder}
        />
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Configure {displayName}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between">
            <Label>Enable Integration</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {webhookInfo && (
            <div className="space-y-2 rounded-xl border border-primary/10 bg-primary/5 p-4">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold">{webhookInfo.label}</h4>
              </div>
              {webhookInfo.description && <p className="text-xs text-muted-foreground">{webhookInfo.description}</p>}
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted px-3 py-2 font-mono text-xs">{webhookInfo.url}</code>
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(webhookInfo.url); toast.success(`${webhookInfo.label} copied!`); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {configFields.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-medium">Configuration</h3>
              {configFields.map(f => renderField(f, config, setConfig))}
            </div>
          )}

          {credentialFields.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-medium">Credentials</h3>
              {credentialFields.map(f => renderField(f, credentials, setCredentials))}
            </div>
          )}

          {schema.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No configuration schema available for this provider.
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
              <Settings className="mr-2 h-4 w-4" />{saveConfig.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
