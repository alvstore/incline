import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ShieldCheck, FileSignature, Mail, Phone, Globe, Monitor, Clock, Download } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';

interface SignedContractViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: any | null;
}

function extractTermsText(terms: any): string {
  if (!terms) return 'No contract terms available.';
  if (typeof terms === 'string') return terms;
  if (typeof terms === 'object' && typeof terms.conditions === 'string') return terms.conditions;
  return JSON.stringify(terms, null, 2);
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return format(new Date(value), 'dd MMM yyyy, hh:mm a');
  } catch {
    return value;
  }
}

export function SignedContractViewer({ open, onOpenChange, contract }: SignedContractViewerProps) {
  const contractId = contract?.id;

  const { data: signature, isLoading: loadingSig } = useQuery({
    queryKey: ['contract-signature', contractId],
    enabled: open && !!contractId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('contract_signatures')
        .select('*')
        .eq('contract_id', contractId)
        .order('signed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: request } = useQuery({
    queryKey: ['contract-signature-request', contractId],
    enabled: open && !!contractId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('contract_signature_requests')
        .select('id, status, created_at, used_at, expires_at, signer_name, signer_contact')
        .eq('contract_id', contractId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const termsText = useMemo(() => extractTermsText(contract?.terms), [contract?.terms]);

  const handlePrint = () => {
    window.print();
  };

  if (!contract) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <SheetTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-success" />
                Signed Contract
              </SheetTitle>
              <SheetDescription>
                Full agreement with digital signature record
              </SheetDescription>
            </div>
            <Badge className="bg-success/15 text-success border border-success/25">
              {contract.signature_status || 'signed'}
            </Badge>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Employee + contract meta */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Employee Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Name</div>
                <div className="font-medium">{contract._resolvedName || 'N/A'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Code</div>
                <div className="font-medium">{contract._resolvedCode || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Type</div>
                <div className="font-medium capitalize">
                  {String(contract.contract_type || '').replace('_', ' ')}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Salary</div>
                <div className="font-medium">
                  ₹{Number(contract.base_salary || contract.salary || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Start Date</div>
                <div className="font-medium">{contract.start_date}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">End Date</div>
                <div className="font-medium">{contract.end_date || 'Permanent'}</div>
              </div>
            </div>
          </div>

          {/* Full agreement terms */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Agreement Terms
            </h3>
            <div className="whitespace-pre-wrap text-sm leading-relaxed bg-muted/30 rounded-lg p-4 max-h-[360px] overflow-y-auto">
              {termsText}
            </div>
          </div>

          <Separator />

          {/* Signature panel */}
          <div className="rounded-xl border-2 border-success/25 bg-success/10 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <FileSignature className="h-5 w-5 text-success" />
              <h3 className="font-semibold text-success">Digital Signature</h3>
            </div>

            {loadingSig ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : signature ? (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Signed Name</div>
                  <div className="font-semibold text-base">{signature.signed_name}</div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">Signature</div>
                  <div className="bg-card border-2 border-dashed border-success/40 rounded-lg p-4 text-center">
                    <span
                      className="text-2xl text-success"
                      style={{ fontFamily: 'Brush Script MT, cursive' }}
                    >
                      {signature.signature_text}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-2">
                  {signature.signer_contact && (
                    <div className="flex items-start gap-2">
                      {/^\+?\d/.test(signature.signer_contact) ? (
                        <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                      ) : (
                        <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                      )}
                      <div>
                        <div className="text-xs text-muted-foreground">Contact</div>
                        <div className="font-medium">{signature.signer_contact}</div>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <div className="text-xs text-muted-foreground">Signed At</div>
                      <div className="font-medium">{formatTimestamp(signature.signed_at)}</div>
                    </div>
                  </div>
                  {signature.ip_address && (
                    <div className="flex items-start gap-2">
                      <Globe className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <div className="text-xs text-muted-foreground">IP Address</div>
                        <div className="font-mono text-xs">{signature.ip_address}</div>
                      </div>
                    </div>
                  )}
                  {signature.user_agent && (
                    <div className="flex items-start gap-2 col-span-full">
                      <Monitor className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">Device</div>
                        <div className="text-xs truncate" title={signature.user_agent}>
                          {signature.user_agent}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                No signature record found. The contract may have been marked signed manually.
              </div>
            )}

            {request && (
              <div className="mt-4 pt-4 border-t border-success/25 text-xs text-muted-foreground">
                Signing link issued {formatTimestamp(request.created_at)} • Expires {formatTimestamp(request.expires_at)}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handlePrint}>
              <Download className="h-4 w-4 mr-2" />
              Print / Save as PDF
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
