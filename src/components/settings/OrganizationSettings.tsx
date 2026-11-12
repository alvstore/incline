import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Building2, Upload, X, Loader2, ImageIcon, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useBranchContext } from '@/contexts/BranchContext';

const ALLOWED_LOGO_MIME_TYPES = [
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

interface OrgSettingsRow {
  id: string;
  branch_id: string | null;
  name: string | null;
  logo_url: string | null;
  timezone: string | null;
  currency: string | null;
  fiscal_year_start: string | null;
}

export function OrganizationSettings() {
  const queryClient = useQueryClient();
  const { selectedBranch, selectedBranchName } = useBranchContext() as any;
  const branchScope: string | null = selectedBranch && selectedBranch !== 'all' ? selectedBranch : null;
  const isBranchScoped = branchScope !== null;

  const [dragActive, setDragActive] = useState(false);

  // Settings row for the active scope (branch or global)
  const { data: scopeSettings, isLoading } = useQuery<OrgSettingsRow | null>({
    queryKey: ['organization-settings', branchScope ?? 'global'],
    queryFn: async () => {
      const base = supabase.from('organization_settings').select('*');
      const q = branchScope
        ? base.eq('branch_id', branchScope)
        : base.is('branch_id', null);
      const { data, error } = await q.limit(1).maybeSingle();
      if (error) throw error;
      return data as OrgSettingsRow | null;
    },
  });

  // Global org row — always fetched, used for fallback preview when branch override missing
  const { data: globalSettings } = useQuery<OrgSettingsRow | null>({
    queryKey: ['organization-settings', 'global'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('*')
        .is('branch_id', null)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as OrgSettingsRow | null;
    },
  });

  const [form, setForm] = useState({
    name: '',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    fiscal_year_start: 'April',
  });

  // Sync form when global org data loads (org-wide details always come from global row)
  const [initialized, setInitialized] = useState(false);
  if (globalSettings && !initialized) {
    setForm({
      name: globalSettings.name || '',
      timezone: globalSettings.timezone || 'Asia/Kolkata',
      currency: globalSettings.currency || 'INR',
      fiscal_year_start: globalSettings.fiscal_year_start || 'April',
    });
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const payload = {
        ...values,
        branch_id: null,
      };
      if (globalSettings?.id) {
        const { error } = await supabase
          .from('organization_settings')
          .update(payload)
          .eq('id', globalSettings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('organization_settings').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['organization-settings'] });
      queryClient.invalidateQueries({ queryKey: ['brand-context'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = branchScope
        ? `branches/${branchScope}/logo-${Date.now()}.${ext}`
        : `org/logo-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('org-assets')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const {
        data: { publicUrl },
      } = supabase.storage.from('org-assets').getPublicUrl(path);

      if (scopeSettings?.id) {
        const { error } = await supabase
          .from('organization_settings')
          .update({ logo_url: publicUrl })
          .eq('id', scopeSettings.id);
        if (error) throw error;
      } else {
        const insertPayload: Record<string, unknown> = {
          branch_id: branchScope, // null for global, uuid for branch
          logo_url: publicUrl,
        };
        // For the global row, also seed org-wide defaults so subsequent saves work
        if (!branchScope) {
          insertPayload.name = form.name || null;
          insertPayload.timezone = form.timezone;
          insertPayload.currency = form.currency;
          insertPayload.fiscal_year_start = form.fiscal_year_start;
        }
        const { error } = await supabase.from('organization_settings').insert(insertPayload);
        if (error) throw error;
      }
      return publicUrl;
    },
    onSuccess: () => {
      toast.success(isBranchScoped ? 'Branch logo uploaded' : 'Logo uploaded');
      queryClient.invalidateQueries({ queryKey: ['organization-settings'] });
      queryClient.invalidateQueries({ queryKey: ['brand-context'] });
    },
    onError: (e: any) => toast.error(e.message || 'Upload failed'),
  });

  const removeLogoMutation = useMutation({
    mutationFn: async () => {
      if (!scopeSettings?.id) return;
      const { error } = await supabase
        .from('organization_settings')
        .update({ logo_url: null })
        .eq('id', scopeSettings.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isBranchScoped ? 'Branch override removed' : 'Logo removed');
      queryClient.invalidateQueries({ queryKey: ['organization-settings'] });
      queryClient.invalidateQueries({ queryKey: ['brand-context'] });
    },
  });

  const handleFile = useCallback(
    (file: File) => {
      const fileName = file.name.toLowerCase();
      const hasSvgExtension = fileName.endsWith('.svg');
      const isAllowedType = ALLOWED_LOGO_MIME_TYPES.includes(
        file.type as (typeof ALLOWED_LOGO_MIME_TYPES)[number],
      );

      if (!isAllowedType && !hasSvgExtension) {
        toast.error('Please upload SVG, PNG, JPG, or WEBP logo');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error('File must be under 5MB');
        return;
      }
      uploadLogoMutation.mutate(file);
    },
    [uploadLogoMutation],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
    },
    [handleFile],
  );

  // Resolved logo to preview: branch override > global org logo > none
  const previewLogo = useMemo(() => {
    if (scopeSettings?.logo_url) {
      return { url: scopeSettings.logo_url, inherited: false };
    }
    if (globalSettings?.logo_url) {
      return { url: globalSettings.logo_url, inherited: isBranchScoped };
    }
    return null;
  }, [scopeSettings?.logo_url, globalSettings?.logo_url, isBranchScoped]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Organization Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your organization's basic information</p>
      </div>

      {/* Brand Logo Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-primary" />
              Brand Logo
            </CardTitle>
            {isBranchScoped ? (
              <Badge variant="secondary" className="rounded-full">
                Editing: {selectedBranchName}
              </Badge>
            ) : (
              <Badge variant="outline" className="rounded-full">
                Organization default
              </Badge>
            )}
          </div>
          <CardDescription>
            {isBranchScoped
              ? 'Upload a logo override for this branch. If empty, the organization logo is used.'
              : 'Upload your brand logo. Used everywhere unless a branch overrides it. Recommended: SVG, transparent background, max 5MB.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-start gap-6">
            {/* Preview plate — wide so wordmarks don't crop */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative group h-24 w-44 rounded-xl border bg-muted/40 p-3 flex items-center justify-center overflow-hidden">
                {previewLogo ? (
                  <>
                    <img
                      src={previewLogo.url}
                      alt="Brand logo"
                      className={`max-h-full max-w-full object-contain ${
                        previewLogo.inherited ? 'opacity-60' : ''
                      }`}
                    />
                    {!previewLogo.inherited && scopeSettings?.logo_url && (
                      <button type="button"
                        onClick={() => removeLogoMutation.mutate()}
                        aria-label="Remove logo"
                        className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </>
                ) : (
                  <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                )}
              </div>
              {previewLogo?.inherited && (
                <Badge variant="outline" className="rounded-full text-[10px] gap-1">
                  <Info className="h-3 w-3" />
                  Inherited from organization
                </Badge>
              )}
              {isBranchScoped && scopeSettings?.logo_url && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => removeLogoMutation.mutate()}
                  disabled={removeLogoMutation.isPending}
                >
                  Remove override
                </Button>
              )}
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`flex-1 w-full border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                dragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50'
              }`}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.svg,image/svg+xml,image/png,image/jpeg,image/webp';
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFile(file);
                };
                input.click();
              }}
            >
              {uploadLogoMutation.isPending ? (
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop or <span className="text-primary font-medium">click to upload</span>
                    {isBranchScoped ? ' branch logo' : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/80">
                    Supports SVG, PNG, JPG, WEBP · max 5MB
                  </p>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Organization Details (always edits the global row) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <CardTitle>Organization Details</CardTitle>
          </div>
          <CardDescription>
            Basic information about your gym. Applies to all branches.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isBranchScoped && (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Info className="h-3.5 w-3.5" />
              Switch the branch selector to <strong>All Branches</strong> to edit organization-wide details.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                placeholder="Your Gym Name"
                value={form.name}
                disabled={isBranchScoped}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                placeholder="Asia/Kolkata"
                value={form.timezone}
                disabled={isBranchScoped}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                placeholder="INR"
                value={form.currency}
                disabled={isBranchScoped}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fiscal-year">Fiscal Year Start</Label>
              <Input
                id="fiscal-year"
                placeholder="April"
                value={form.fiscal_year_start}
                disabled={isBranchScoped}
                onChange={(e) => setForm((f) => ({ ...f, fiscal_year_start: e.target.value }))}
              />
            </div>
          </div>
          <Button
            className="w-full md:w-auto"
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending || isBranchScoped}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
