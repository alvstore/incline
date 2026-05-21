import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import SignatureCanvas from 'react-signature-canvas';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { FileSignature, ShieldCheck, Eraser, ScrollText, CheckCircle2, MessageSquare, Mail, Smartphone, KeyRound } from 'lucide-react';
import { useNoindex } from '@/lib/seo/useNoindex';

function extractTerms(terms: any): string {
  if (!terms) return 'No contract terms available.';
  if (typeof terms === 'string') return terms;
  if (typeof terms === 'object' && typeof terms.conditions === 'string') return terms.conditions;
  return JSON.stringify(terms, null, 2);
}

type Channel = 'whatsapp' | 'sms' | 'email';

export default function ContractSignPage() {
  useNoindex('Sign Contract | The Incline Life');
  const { token } = useParams();
  const sigRef = useRef<SignatureCanvas | null>(null);
  const termsScrollRef = useRef<HTMLDivElement | null>(null);

  const [signedName, setSignedName] = useState('');
  const [signerContact, setSignerContact] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const [witness1, setWitness1] = useState({ name: '', phone: '' });
  const [witness2, setWitness2] = useState({ name: '', phone: '' });
  const [consent, setConsent] = useState(false);
  const [reachedBottom, setReachedBottom] = useState(false);
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [signed, setSigned] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState<{ channel: Channel; recipient_masked: string; expires_at: string } | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-contract-sign', token],
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
  const employer = contract?.employer;
  const termsText = useMemo(() => extractTerms(contract?.terms), [contract?.terms]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => {},
      { maximumAge: 60_000, timeout: 5_000 }
    );
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  function onTermsScroll() {
    const el = termsScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom && !reachedBottom) setReachedBottom(true);
  }

  const otpMutation = useMutation({
    mutationFn: async (channel: Channel) => {
      const { data, error } = await supabase.functions.invoke('contract-signing', {
        body: { action: 'request_otp', token, channel },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      setOtpSent({ channel: data.channel, recipient_masked: data.recipient_masked, expires_at: data.expires_at });
      setResendCooldown(30);
      toast.success(`Code sent to ${data.recipient_masked}`);
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to send code'),
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('Missing signing token');
      if (!sigRef.current || sigRef.current.isEmpty()) {
        throw new Error('Please draw your signature in the box.');
      }
      if (!/^\d{6}$/.test(otp)) throw new Error('Enter the 6-digit code sent to you.');
      const signature_image_base64 = sigRef.current.getCanvas().toDataURL('image/png');

      const { data, error } = await supabase.functions.invoke('contract-signing', {
        body: {
          action: 'sign_contract',
          token,
          otp,
          signed_name: signedName.trim(),
          signer_contact: signerContact.trim() || null,
          signature_text: signatureText.trim() || signedName.trim(),
          consent,
          signature_image_base64,
          geolocation: geo,
          witness_1: witness1.name ? witness1 : null,
          witness_2: witness2.name ? witness2 : null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success('Contract signed successfully');
      setSigned(true);
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to sign contract'),
  });

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading contract...</div>;

  if (error || !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-xl w-full">
          <CardHeader>
            <CardTitle>Invalid or Expired Link</CardTitle>
            <CardDescription>This contract signing link is invalid, expired, or already used.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (signed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-lg w-full rounded-2xl shadow-lg shadow-slate-200/50">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <CardTitle>Contract signed</CardTitle>
            <CardDescription>
              A stamped PDF copy has been sent to you and saved to your employee record.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const canSubmit =
    reachedBottom &&
    !!signedName.trim() &&
    consent &&
    /^\d{6}$/.test(otp) &&
    !signMutation.isPending;

  const hasPhone = !!contract.employee_phone_masked;
  const hasEmail = !!contract.employee_email_masked;

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-indigo-600" />
              Employment Agreement — Signature
            </CardTitle>
            <CardDescription>
              {employer?.legal_name ? `Issued by ${employer.legal_name}` : 'Please read every clause'},
              draw your signature and verify the one-time code we send you. Your acceptance is recorded
              as a valid electronic signature under Section 10A of the IT Act, 2000.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div><strong>Employee:</strong> {contract.employee_name}</div>
              <div><strong>Code:</strong> {contract.employee_code}</div>
              <div><strong>Type:</strong> <span className="capitalize">{String(contract.contract_type || '').replace('_', ' ')}</span></div>
              <div><strong>Salary:</strong> ₹{Number(contract.salary || 0).toLocaleString('en-IN')}</div>
              <div><strong>Start date:</strong> {contract.start_date}</div>
              <div><strong>Status:</strong> <Badge variant="outline">{contract.signature_status || 'sent'}</Badge></div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <ScrollText className="h-4 w-4" /> Contract Terms
                </h3>
                {reachedBottom ? (
                  <Badge className="bg-emerald-100 text-emerald-700">Read</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-700">Scroll to bottom to enable signing</Badge>
                )}
              </div>
              <div
                ref={termsScrollRef}
                onScroll={onTermsScroll}
                className="rounded-md border bg-white p-4 max-h-[420px] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed"
              >
                {termsText}
              </div>
            </div>

            <Separator />

            {/* OTP block */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-indigo-600" />
                <h3 className="font-semibold text-sm">Verify with one-time code</h3>
              </div>
              {!otpSent ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-600">Send a 6-digit code to your registered contact to confirm it's really you.</p>
                  <div className="flex flex-wrap gap-2">
                    {hasPhone && (
                      <Button size="sm" variant="outline" disabled={otpMutation.isPending}
                        onClick={() => otpMutation.mutate('whatsapp')}>
                        <MessageSquare className="h-3.5 w-3.5 mr-1" /> WhatsApp to {contract.employee_phone_masked}
                      </Button>
                    )}
                    {hasPhone && (
                      <Button size="sm" variant="outline" disabled={otpMutation.isPending}
                        onClick={() => otpMutation.mutate('sms')}>
                        <Smartphone className="h-3.5 w-3.5 mr-1" /> SMS to {contract.employee_phone_masked}
                      </Button>
                    )}
                    {hasEmail && (
                      <Button size="sm" variant="outline" disabled={otpMutation.isPending}
                        onClick={() => otpMutation.mutate('email')}>
                        <Mail className="h-3.5 w-3.5 mr-1" /> Email to {contract.employee_email_masked}
                      </Button>
                    )}
                    {!hasPhone && !hasEmail && (
                      <p className="text-xs text-red-600">No phone or email on record. Please contact HR.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-600">
                    Code sent via <strong className="capitalize">{otpSent.channel}</strong> to <strong>{otpSent.recipient_masked}</strong>. It expires in 10 minutes.
                  </p>
                  <div className="flex gap-2 items-end">
                    <div className="space-y-1 flex-1 max-w-[200px]">
                      <Label htmlFor="otp" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">6-digit code</Label>
                      <Input
                        id="otp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="• • • • • •"
                        className="tracking-widest text-center font-mono text-lg"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resendCooldown > 0 || otpMutation.isPending}
                      onClick={() => otpMutation.mutate(otpSent.channel)}
                    >
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setOtpSent(null); setOtp(''); }}
                    >
                      Change method
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="signed-name">Full legal name *</Label>
                  <Input id="signed-name" value={signedName} onChange={(e) => setSignedName(e.target.value)} placeholder="As per PAN / Aadhaar" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signer-contact">Phone or email (optional)</Label>
                  <Input id="signer-contact" value={signerContact} onChange={(e) => setSignerContact(e.target.value)} placeholder="For confirmation" />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Draw your signature *</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => sigRef.current?.clear()}>
                    <Eraser className="h-3.5 w-3.5 mr-1" /> Clear
                  </Button>
                </div>
                <div className="rounded-md border-2 border-dashed border-indigo-200 bg-white">
                  <SignatureCanvas
                    ref={(r) => { sigRef.current = r; }}
                    penColor="#1e1b4b"
                    canvasProps={{ className: 'w-full h-40 rounded-md' }}
                  />
                </div>
                <p className="text-xs text-slate-500">Use mouse, stylus or finger on touch devices.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Witness 1 — Name</Label>
                  <Input value={witness1.name} onChange={(e) => setWitness1({ ...witness1, name: e.target.value })} />
                  <Input value={witness1.phone} onChange={(e) => setWitness1({ ...witness1, phone: e.target.value })} placeholder="Phone" />
                </div>
                <div className="space-y-2">
                  <Label>Witness 2 — Name</Label>
                  <Input value={witness2.name} onChange={(e) => setWitness2({ ...witness2, name: e.target.value })} />
                  <Input value={witness2.phone} onChange={(e) => setWitness2({ ...witness2, phone: e.target.value })} placeholder="Phone" />
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-md border p-3 bg-white">
                <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} />
                <Label htmlFor="consent" className="text-sm leading-relaxed">
                  I confirm I have read and agree to this contract and the linked policies. I consent
                  to my electronic signature, IP address{geo ? ', geo-location' : ''} and device details
                  being recorded as legal evidence under the IT Act, 2000 and the Indian Evidence Act, 1872.
                </Label>
              </div>

              <Button
                className="w-full bg-indigo-600 hover:bg-indigo-700"
                disabled={!canSubmit}
                onClick={() => signMutation.mutate()}
                aria-label="Sign contract"
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                {signMutation.isPending ? 'Signing...' : 'Sign contract'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
