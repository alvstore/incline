import { useState, useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Printer, Save, FileSignature, Eraser, Dumbbell, Shield, HeartPulse, User, Calendar, MapPin, ChevronDown, CheckCircle2, Download, Eye, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { signMemberDocument, signOnboardingDocument } from '@/lib/documents/signMemberDocument';
import { format } from 'date-fns';
import { buildMembershipAgreementPdf, printBlob } from '@/utils/pdfBlob';
import { useBrandContext } from '@/lib/brand/useBrandContext';
import {
  AGREEMENT_PARTS,
  AGREEMENT_ACKNOWLEDGEMENTS,
  AGREEMENT_VERSION,
  FINAL_DECLARATION,
  REQUIRED_ACKNOWLEDGEMENT_KEYS,
  acknowledgementsForPart,
} from '@/lib/registration/agreement';
import {
  PARQ_QUESTIONS,
  PRIMARY_GOALS,
  MORE_GOALS,
  HEALTH_CONDITION_OPTIONS,
  parseHealthConditions,
  joinHealthConditions,
} from '@/lib/registration/healthQuestions';

/** Canonical single document — one per member, upserted on re-sign. */
const AGREEMENT_FILENAME = 'membership-agreement.pdf';
const partTitle = (id: string) => {
  const p = AGREEMENT_PARTS.find((x) => x.id === id);
  return p ? `Part ${p.id} — ${p.title}` : id;
};

interface RegistrationFormData {
  memberName: string;
  memberCode: string;
  email?: string;
  phone?: string;
  gender?: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  state?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  planName?: string;
  startDate?: string;
  endDate?: string;
  pricePaid?: number;
  branchName?: string;
  memberId?: string;
  fitnessGoals?: string;
  medicalConditions?: string;
  governmentIdType?: string;
  governmentIdNumber?: string;
}

interface MemberRegistrationFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: RegistrationFormData;
}


export function MemberRegistrationFormDrawer({ open, onOpenChange, data }: MemberRegistrationFormProps) {
  const queryClient = useQueryClient();
  const { data: brand } = useBrandContext(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);
  const [govIdType, setGovIdType] = useState(data.governmentIdType || 'aadhaar');
  const [govIdNumber, setGovIdNumber] = useState(data.governmentIdNumber || '');
  const [fitnessGoals, setFitnessGoals] = useState(data.fitnessGoals || '');
  const [medicalConditions, setMedicalConditions] = useState(data.medicalConditions || '');
  const [healthChips, setHealthChips] = useState<string[]>(() => parseHealthConditions(data.medicalConditions).selected);
  const [healthOther, setHealthOther] = useState<string>(() => parseHealthConditions(data.medicalConditions).other);
  const [showMoreGoals, setShowMoreGoals] = useState(false);
  const [parq, setParq] = useState<Record<string, 'yes' | 'no'>>({});
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [customTerms, setCustomTerms] = useState('');
  const [saving, setSaving] = useState(false);
  const [existingSignature, setExistingSignature] = useState<{
    waiver_pdf_path: string | null;
    signature_path: string | null;
    signed_at: string | null;
    source: string | null;
    bucket: 'documents' | 'member-onboarding';
    acks: Record<string, boolean>;
  } | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  const signAgreementDoc = useCallback(
    (path: string, bucket: 'documents' | 'member-onboarding') =>
      bucket === 'documents' ? signMemberDocument(path, 300, 'documents') : signOnboardingDocument(path, 300),
    [],
  );

  // Re-sync prefilled values when drawer opens or member changes
  useEffect(() => {
    if (!open) return;
    setGovIdType(data.governmentIdType || 'aadhaar');
    setGovIdNumber(data.governmentIdNumber || '');
    setFitnessGoals(data.fitnessGoals || '');
    setMedicalConditions(data.medicalConditions || '');
    const parsed = parseHealthConditions(data.medicalConditions);
    setHealthChips(parsed.selected);
    setHealthOther(parsed.other);
  }, [open, data.memberId, data.governmentIdType, data.governmentIdNumber, data.fitnessGoals, data.medicalConditions]);

  // Load the latest agreement signature + PAR-Q + acknowledgements. This
  // hydrates everything the member entered during /register (public
  // self-onboarding) so staff never re-collect the same declarations.
  useEffect(() => {
    if (!open || !data.memberId) return;
    let cancelled = false;
    (async () => {
      const { data: row } = await supabase
        .from('member_onboarding_signatures')
        .select('par_q, custom_terms, waiver_pdf_path, signature_path, signed_at, consents')
        .eq('member_id', data.memberId!)
        .order('signed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (row?.par_q && typeof row.par_q === 'object') {
        const map: Record<string, 'yes' | 'no'> = {};
        const src = row.par_q as Record<string, string>;
        PARQ_QUESTIONS.forEach((q, i) => {
          const v = src[q] ?? src[`q${i}`];
          if (v === 'yes' || v === 'no') map[`q${i}`] = v;
        });
        setParq(map);
      }
      if (typeof (row as any)?.custom_terms === 'string') {
        setCustomTerms((row as any).custom_terms);
      }
      const consents = (row?.consents as Record<string, unknown> | null) ?? null;
      const storedAcks: Record<string, boolean> = {};
      AGREEMENT_ACKNOWLEDGEMENTS.forEach((a) => {
        if (consents && typeof consents[a.key] === 'boolean') storedAcks[a.key] = consents[a.key] as boolean;
      });
      if (Object.keys(storedAcks).length) setAcks(storedAcks);

      if (row?.waiver_pdf_path || row?.signature_path) {
        const source = (consents?.source as string | undefined) ?? null;
        const bucket = ((consents?.pdf_bucket as string | undefined) ?? 'member-onboarding') as
          | 'documents'
          | 'member-onboarding';
        setExistingSignature({
          waiver_pdf_path: row?.waiver_pdf_path ?? null,
          signature_path: row?.signature_path ?? null,
          signed_at: row?.signed_at ?? null,
          source,
          bucket,
          acks: storedAcks,
        });
        setEditMode(false);
        if (row?.signature_path) {
          const url = await signAgreementDoc(row.signature_path, bucket).catch(() => null);
          if (!cancelled) setSignatureUrl(url);
        }
      } else {
        setExistingSignature(null);
        setEditMode(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, data.memberId, signAgreementDoc]);


  // Keep medicalConditions string in sync with chips for PDF/print
  useEffect(() => {
    setMedicalConditions(joinHealthConditions(healthChips, healthOther));
  }, [healthChips, healthOther]);

  // Setup canvas for signature
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
      ctx.scale(2, 2);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }, 100);
    return () => clearTimeout(timer);
  }, [open]);

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }, []);

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }, [getPos]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasSigned(true);
  }, [isDrawing, getPos]);

  const stopDraw = useCallback(() => setIsDrawing(false), []);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
  };

  const missingAcks = REQUIRED_ACKNOWLEDGEMENT_KEYS.filter((k) => acks[k] !== true);

  const buildAgreementBlob = async (signatureDataUrl: string | null, signedAt: string) => {
    const parqMap: Record<string, string> = {};
    PARQ_QUESTIONS.forEach((q, i) => { parqMap[q] = parq[`q${i}`] || 'no'; });
    const blob = await buildMembershipAgreementPdf({
      data,
      govIdType,
      govIdNumber,
      fitnessGoals,
      medicalConditions,
      parq: parqMap,
      parqQuestions: [...PARQ_QUESTIONS],
      customTerms,
      acknowledgements: acks,
      signatureDataUrl,
      signedAt,
    }, brand);
    return { blob, parqMap };
  };

  const handleSaveDigital = async () => {
    if (!hasSigned) {
      toast.error('Please sign the agreement first');
      return;
    }
    if (!data.memberId) {
      toast.error('Member ID missing');
      return;
    }
    if (missingAcks.length) {
      toast.error('Please tick every mandatory acknowledgement before signing');
      return;
    }

    setSaving(true);
    try {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas not found');
      const signatureDataUrl = canvas.toDataURL('image/png');
      const signedAt = new Date().toISOString();

      const { blob: pdfBlob, parqMap } = await buildAgreementBlob(signatureDataUrl, signedAt);

      // ONE canonical document per member — re-signing overwrites in place.
      const fileName = `${data.memberId}/${AGREEMENT_FILENAME}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, pdfBlob, { contentType: 'application/pdf', upsert: true });
      if (uploadError) throw uploadError;

      const { data: { user } } = await supabase.auth.getUser();
      const { data: existingDoc } = await supabase
        .from('member_documents')
        .select('id')
        .eq('member_id', data.memberId)
        .eq('document_type', 'registration_form')
        .maybeSingle();

      const docRow = {
        member_id: data.memberId,
        document_type: 'registration_form',
        file_url: '',
        storage_path: fileName,
        file_name: `Membership-Agreement-${data.memberCode}.pdf`,
        uploaded_by: user?.id,
      };
      const { error: docError } = existingDoc
        ? await supabase.from('member_documents').update(docRow).eq('id', existingDoc.id)
        : await supabase.from('member_documents').insert(docRow);
      if (docError) throw docError;

      // Sync edits back to canonical records (best-effort, non-blocking)
      try {
        const memberUpdates: Record<string, string> = {};
        if (fitnessGoals && fitnessGoals !== (data.fitnessGoals || '')) memberUpdates.fitness_goals = fitnessGoals;
        if (medicalConditions && medicalConditions !== (data.medicalConditions || '')) memberUpdates.health_conditions = medicalConditions;
        if (Object.keys(memberUpdates).length) {
          await supabase.from('members').update(memberUpdates).eq('id', data.memberId);
        }
        const profileUpdates: Record<string, string> = {};
        if (govIdType && govIdType !== (data.governmentIdType || 'aadhaar')) profileUpdates.government_id_type = govIdType;
        if (govIdNumber && govIdNumber !== (data.governmentIdNumber || '')) profileUpdates.government_id_number = govIdNumber;
        if (Object.keys(profileUpdates).length) {
          const { data: m } = await supabase.from('members').select('user_id').eq('id', data.memberId).maybeSingle();
          if (m?.user_id) await (supabase.from('profiles') as any).update(profileUpdates).eq('user_id', m.user_id);
        }
      } catch (syncErr) {
        console.warn('[RegistrationForm] profile sync failed', syncErr);
      }

      // ONE signature record for the ONE document.
      try {
        await supabase.from('member_onboarding_signatures').insert({
          member_id: data.memberId,
          signature_path: fileName,
          waiver_pdf_path: fileName,
          par_q: parqMap,
          custom_terms: customTerms || null,
          terms_version: AGREEMENT_VERSION,
          consents: {
            ...acks,
            waiver: true,
            source: 'staff_registration_form',
            pdf_bucket: 'documents',
          },
          signed_at: signedAt,
        });
      } catch (sigErr) {
        console.warn('[RegistrationForm] signature snapshot failed', sigErr);
      }

      toast.success('Membership agreement signed and stored');
      queryClient.invalidateQueries({ queryKey: ['member-documents', data.memberId] });
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = async () => {
    const signatureDataUrl = hasSigned ? canvasRef.current?.toDataURL('image/png') ?? null : null;
    const { blob } = await buildAgreementBlob(signatureDataUrl, new Date().toISOString());
    printBlob(blob);
  };


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            Membership Registration Form
          </SheetTitle>
          <SheetDescription>
            Complete the form below and collect the member's digital signature
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Member Info Summary */}
          <Card className="bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-full bg-primary/10">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground text-xs block">Name</span><span className="font-medium">{data.memberName}</span></div>
                  <div><span className="text-muted-foreground text-xs block">Code</span><span className="font-medium">{data.memberCode}</span></div>
                  <div><span className="text-muted-foreground text-xs block">Email</span><span>{data.email || '—'}</span></div>
                  <div><span className="text-muted-foreground text-xs block">Phone</span><span>{data.phone || '—'}</span></div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Membership Details */}
          {data.planName && (
            <Card className="border-success/20 bg-success/5">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="h-4 w-4 text-success" />
                  <span className="font-semibold text-sm">Membership Details</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground text-xs block">Plan</span><Badge variant="secondary">{data.planName}</Badge></div>
                  <div><span className="text-muted-foreground text-xs block">Amount</span><span className="font-bold">₹{data.pricePaid?.toLocaleString('en-IN')}</span></div>
                  <div><span className="text-muted-foreground text-xs block">Start</span><span>{data.startDate ? format(new Date(data.startDate), 'dd MMM yyyy') : '—'}</span></div>
                  <div><span className="text-muted-foreground text-xs block">End</span><span>{data.endDate ? format(new Date(data.endDate), 'dd MMM yyyy') : '—'}</span></div>
                </div>
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* Government ID */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-primary" />
              <Label className="font-semibold">Government ID</Label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">ID Type</Label>
                <Select value={govIdType} onValueChange={setGovIdType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aadhaar">Aadhaar Card</SelectItem>
                    <SelectItem value="pan">PAN Card</SelectItem>
                    <SelectItem value="passport">Passport</SelectItem>
                    <SelectItem value="voter_id">Voter ID</SelectItem>
                    <SelectItem value="driving_license">Driving License</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">ID Number</Label>
                <Input value={govIdNumber} onChange={e => setGovIdNumber(e.target.value)} placeholder="Enter ID number" />
              </div>
            </div>
          </div>

          {/* Fitness Goals & Medical — chip pickers (parity with /register) */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <HeartPulse className="h-4 w-4 text-primary" />
              <Label className="font-semibold">Health & Fitness</Label>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Primary Fitness Goal</Label>
                <div className="grid grid-cols-2 gap-2">
                  {PRIMARY_GOALS.map((g) => {
                    const Icon = g.icon;
                    const active = fitnessGoals === g.key;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setFitnessGoals(active ? '' : g.key)}
                        className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-all ${
                          active
                            ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                            : 'border-border bg-background hover:bg-muted'
                        }`}
                      >
                        <div className={`rounded-lg p-1.5 ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-medium">{g.key}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setShowMoreGoals((v) => !v)}
                  className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMoreGoals ? 'rotate-180' : ''}`} />
                  {showMoreGoals ? 'Fewer' : 'More options'}
                </button>
                {showMoreGoals && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {MORE_GOALS.map((g) => {
                      const active = fitnessGoals === g;
                      return (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setFitnessGoals(active ? '' : g)}
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                            active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                          }`}
                        >
                          {g}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Health Conditions / Injuries (tap all that apply)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {HEALTH_CONDITION_OPTIONS.map((opt) => {
                    const checked = healthChips.includes(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          setHealthChips((prev) => checked ? prev.filter((p) => p !== opt) : [...prev, opt])
                        }
                        className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                          checked
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'bg-muted text-muted-foreground ring-1 ring-inset ring-border hover:bg-muted/70'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {healthChips.includes('Other') && (
                  <Input
                    placeholder="Please specify"
                    value={healthOther}
                    onChange={(e) => setHealthOther(e.target.value)}
                    className="mt-2"
                  />
                )}
                <p className="text-[11px] text-muted-foreground">Confidential — only the member's trainer & medical staff see this.</p>
              </div>
            </div>
          </div>

          {/* PAR-Q Health Screen */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-primary" />
              <Label className="font-semibold">PAR-Q Health Screen</Label>
            </div>
            <p className="text-xs text-muted-foreground mb-2">Quick health check — answer honestly to keep the member safe.</p>
            <div className="space-y-2">
              {PARQ_QUESTIONS.map((q, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-3">
                  <p className="text-xs font-medium mb-2">{i + 1}. {q}</p>
                  <div className="flex gap-2">
                    {(['no', 'yes'] as const).map((v) => {
                      const active = parq[`q${i}`] === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setParq((p) => ({ ...p, [`q${i}`]: v }))}
                          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                            active
                              ? v === 'yes'
                                ? 'bg-warning text-primary-foreground shadow-sm'
                                : 'bg-success text-primary-foreground shadow-sm'
                              : 'bg-muted text-muted-foreground ring-1 ring-inset ring-border hover:bg-muted/70'
                          }`}
                        >
                          {v.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>


          {/* Member-specific addendum (printed inside Part E) */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Dumbbell className="h-4 w-4 text-primary" />
              <Label className="font-semibold">{partTitle('E')} — Member-Specific Addendum (Optional)</Label>
            </div>
            <Textarea value={customTerms} onChange={e => setCustomTerms(e.target.value)}
              placeholder="Add any custom terms or conditions specific to this member..."
              className="min-h-[50px]" />
            <p className="text-xs text-muted-foreground mt-1">
              All standard clauses in Parts D–H are printed in the agreement automatically. Use this field only for member-specific addendums.
            </p>
          </div>

          <Separator />

          {/* Acknowledgements — one signature, multiple acknowledgements */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <Label className="font-semibold">{partTitle('I')} — Acknowledgements</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              One signature covers the whole agreement. Tick each acknowledgement below — mandatory ones are required.
            </p>
            {AGREEMENT_PARTS.filter((p) => acknowledgementsForPart(p.id).length).map((p) => (
              <div key={p.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {partTitle(p.id)}
                </p>
                {acknowledgementsForPart(p.id).map((a) => (
                  <label key={a.key} className="flex items-start gap-2 cursor-pointer">
                    <Checkbox
                      checked={acks[a.key] === true}
                      onCheckedChange={(v) => setAcks((prev) => ({ ...prev, [a.key]: v === true }))}
                      className="mt-0.5"
                      aria-label={a.label}
                    />
                    <span className="text-xs leading-relaxed text-foreground">
                      {a.label}
                      {a.required && <span className="text-destructive"> *</span>}
                    </span>
                  </label>
                ))}
              </div>
            ))}
            <p className="text-xs italic text-muted-foreground">{FINAL_DECLARATION}</p>
            {missingAcks.length > 0 && (
              <p className="text-xs font-medium text-destructive">
                {missingAcks.length} mandatory acknowledgement{missingAcks.length > 1 ? 's' : ''} pending.
              </p>
            )}
          </div>


          <Separator />

          {/* Digital Signature — hidden when member already signed via /register */}
          {existingSignature && !editMode ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <Label className="font-semibold text-emerald-800">
                  Already signed{existingSignature.source === 'self_register' ? ' during self-registration' : ''}
                </Label>
              </div>
              {existingSignature.signed_at && (
                <p className="text-xs text-emerald-700/80">
                  Signed on {new Date(existingSignature.signed_at).toLocaleString('en-IN')}
                </p>
              )}
              {signatureUrl && (
                <img
                  src={signatureUrl}
                  alt="Member signature"
                  className="max-h-24 rounded border border-emerald-200 bg-white p-1"
                />
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {existingSignature.waiver_pdf_path && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const url = await signAgreementDoc(existingSignature.waiver_pdf_path!, existingSignature.bucket);
                      if (url) window.open(url, '_blank', 'noopener');
                    }}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" /> View signed agreement
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditMode(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Re-sign
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileSignature className="h-4 w-4 text-primary" />
                  <Label className="font-semibold">Digital Signature</Label>
                </div>
                <Button variant="ghost" size="sm" onClick={clearSignature} className="text-xs">
                  <Eraser className="h-3 w-3 mr-1" /> Clear
                </Button>
              </div>
              <div className="border-2 border-dashed border-muted-foreground/30 rounded-xl bg-muted/30 relative">
                <canvas
                  ref={canvasRef}
                  className="w-full h-[140px] cursor-crosshair touch-none"
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={stopDraw}
                  onMouseLeave={stopDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={stopDraw}
                />
                {!hasSigned && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <p className="text-muted-foreground/50 text-sm">Sign here ✍️</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Draw your signature above using mouse or touch. This will be saved digitally.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2 pb-4">
            <Button variant="outline" className="flex-1" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
            {existingSignature && !editMode ? (
              <Button
                variant="outline"
                className="flex-1"
                onClick={async () => {
                  const path = existingSignature.waiver_pdf_path || existingSignature.signature_path;
                  if (!path) return;
                  const url = await signAgreementDoc(path, existingSignature.bucket);
                  if (url) window.open(url, '_blank', 'noopener');
                }}
              >
                <Download className="h-4 w-4 mr-2" /> Download signed copy
              </Button>
            ) : (
              <Button className="flex-1" onClick={handleSaveDigital} disabled={saving || !hasSigned || missingAcks.length > 0}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Sign & Store Agreement'}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}


