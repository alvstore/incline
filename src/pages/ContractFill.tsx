import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  ClipboardCheck, ShieldCheck, ArrowRight, CheckCircle2,
} from 'lucide-react';
import { useNoindex } from '@/lib/seo/useNoindex';
import {
  type FillRole,
  type VariableSpec,
  variablesFor,
  missingRequiredKeys,
} from '@/lib/hrm/contractVariables';

/**
 * Public role-scoped contract fill page.
 *   /contract-fill/:token?role=employee|witness_1|witness_2|hr
 *
 * Token = same `contract_signature_requests.token_hash` used by /contract-sign.
 * The role on the request row determines which fields are editable; the query
 * param is informational only — the server still enforces the allowlist.
 */
export default function ContractFillPage() {
  useNoindex('Complete Contract Details | The Incline Life');
  const { token } = useParams();
  const navigate = useNavigate();

  const [values, setValues] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-contract-fill', token],
    enabled: Boolean(token),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('contract-signing', {
        body: { action: 'get_contract', token },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });

  const contract = data?.contract;
  const role: FillRole = (contract?.request_role as FillRole) || 'employee';
  const employer = contract?.employer;
  const existingVars = (contract?.contract_variables ?? {}) as Record<string, string>;

  useEffect(() => {
    if (existingVars && Object.keys(existingVars).length > 0) {
      setValues((prev) => ({ ...existingVars, ...prev }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract?.id]);

  const fields = useMemo<VariableSpec[]>(() => variablesFor(role), [role]);
  const mergedVars = useMemo(() => ({ ...existingVars, ...values }), [existingVars, values]);
  const remainingRequired = missingRequiredKeys(mergedVars);

  const fillMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = {};
      for (const f of fields) {
        const v = values[f.key];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          payload[f.key] = String(v).trim();
        }
      }
      const { data, error } = await supabase.functions.invoke('contract-signing', {
        body: { action: 'fill_fields', token, variables: payload },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success('Details saved');
      const stillMissing = (data?.missing_required ?? []) as string[];
      // If this is the employee role and required fields are complete, go to signing.
      if (role === 'employee' && stillMissing.length === 0) {
        navigate(`/contract-sign/${token}`);
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to save details'),
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }
  if (error || !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-xl w-full">
          <CardHeader>
            <CardTitle>Invalid or expired link</CardTitle>
            <CardDescription>This contract link is invalid, expired or already used.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const allDone =
    role === 'employee'
      ? remainingRequired.filter((k) => fields.some((f) => f.key === k)).length === 0
      : fields.every((f) => !f.required || (mergedVars[f.key] ?? '').toString().trim() !== '');

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-indigo-600" />
              Complete your contract details
            </CardTitle>
            <CardDescription>
              {employer?.legal_name ? `${employer.legal_name} — ` : ''}
              {role === 'employee' && 'Please fill in the missing details below before signing your employment agreement.'}
              {role === 'witness_1' && 'You have been invited as Witness 1. Please confirm your details.'}
              {role === 'witness_2' && 'You have been invited as Witness 2. Please confirm your details.'}
              {role === 'hr' && 'Fill any HR-only fields and witness pre-fills before issuing the signing link.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div><strong>Employee:</strong> {contract.employee_name}</div>
              <div><strong>Code:</strong> {contract.employee_code}</div>
              <div><strong>Role:</strong> <Badge variant="outline" className="capitalize">{role.replace('_', ' ')}</Badge></div>
              <div><strong>Required remaining:</strong>{' '}
                {remainingRequired.length === 0
                  ? <Badge className="bg-emerald-100 text-emerald-700">All set</Badge>
                  : <Badge className="bg-amber-100 text-amber-700">{remainingRequired.length} pending</Badge>}
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={f.key}>
                      {f.label} {f.required && <span className="text-red-500">*</span>}
                    </Label>
                    {(mergedVars[f.key] ?? '').toString().trim() !== '' && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="filled" />
                    )}
                  </div>
                  {f.input === 'textarea' ? (
                    <Textarea
                      id={f.key}
                      value={values[f.key] ?? existingVars[f.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                      rows={3}
                    />
                  ) : (
                    <Input
                      id={f.key}
                      type={f.input === 'number' ? 'number' : f.input === 'tel' ? 'tel' : 'text'}
                      value={values[f.key] ?? existingVars[f.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                    />
                  )}
                  {f.helper && <p className="text-xs text-slate-500">{f.helper}</p>}
                </div>
              ))}
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
              {role === 'employee' && (
                <Button
                  variant="outline"
                  onClick={() => navigate(`/contract-sign/${token}`)}
                  disabled={!allDone}
                  title={allDone ? 'Continue to signing' : 'Fill all required fields first'}
                >
                  Skip to sign <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              )}
              <Button
                className="bg-indigo-600 hover:bg-indigo-700"
                onClick={() => fillMutation.mutate()}
                disabled={fillMutation.isPending}
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                {fillMutation.isPending ? 'Saving…' : role === 'employee' ? 'Save & continue' : 'Save details'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
