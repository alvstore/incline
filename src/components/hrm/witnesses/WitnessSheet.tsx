import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SignaturePad, type SignaturePadHandle } from '@/components/registration/SignaturePad';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { WITNESS_BUCKET, useWitnessSignatureUrl, type ContractWitness } from './useContractWitnesses';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branchId: string | null;
  witness?: ContractWitness | null;
  onSaved?: (w: ContractWitness) => void;
}

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];

async function dataUrlToBlob(dataUrl: string) {
  return (await fetch(dataUrl)).blob();
}

export function WitnessSheet({ open, onOpenChange, branchId, witness, onSaved }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const padRef = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [designation, setDesignation] = useState('');
  const [active, setActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [padEmpty, setPadEmpty] = useState(true);
  const existingUrl = useWitnessSignatureUrl(witness?.signature_path);

  useEffect(() => {
    if (!open) return;
    setName(witness?.full_name ?? '');
    setPhone(witness?.phone ?? '+91');
    setDesignation(witness?.designation ?? '');
    setActive(witness?.is_active ?? true);
    setFile(null); setPadEmpty(true); setMode('draw');
  }, [open, witness]);

  const save = useMutation({
    mutationFn: async (): Promise<ContractWitness> => {
      const cleanName = name.trim();
      if (!cleanName) throw new Error('Name is required');
      const digits = phone.replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');
      if (digits && digits.length !== 10) throw new Error('Enter a 10-digit mobile number');
      let signaturePath = witness?.signature_path ?? null;
      let blob: Blob | null = null;
      if (mode === 'upload' && file) {
        if (!ALLOWED.includes(file.type)) throw new Error('Use a PNG, JPG or WEBP image');
        if (file.size > MAX_BYTES) throw new Error('Signature image must be under 2 MB');
        blob = file;
      } else if (mode === 'draw' && padRef.current && !padRef.current.isEmpty()) {
        blob = await dataUrlToBlob(padRef.current.toDataURL());
      }
      if (blob) {
        const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
        const path = `${branchId ?? 'global'}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from(WITNESS_BUCKET).upload(path, blob, { contentType: blob.type || 'image/png', upsert: false });
        if (error) throw error;
        signaturePath = path;
      }
      const row = {
        full_name: cleanName,
        phone: digits ? `+91${digits}` : null,
        designation: designation.trim() || null,
        signature_path: signaturePath,
        is_active: active,
      };
      const res = witness
        ? await supabase.from('contract_witnesses').update(row).eq('id', witness.id).select().single()
        : await supabase.from('contract_witnesses').insert({ ...row, branch_id: branchId, created_by: user?.id ?? null }).select().single();
      if (res.error) throw res.error;
      return res.data as ContractWitness;
    },
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['contract-witnesses'] });
      toast.success(witness ? 'Witness updated' : 'Witness saved');
      onSaved?.(w);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save witness'),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
        <SheetHeader className="p-6 border-b border-border">
          <SheetTitle>{witness ? 'Edit witness' : 'Add witness'}</SheetTitle>
          <SheetDescription>Saved witnesses can be picked on any contract. Their signature prints on the PDF.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="w-name">Full name *</Label>
            <Input id="w-name" value={name} onChange={(e) => setName(e.target.value)} aria-required className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-phone">Mobile</Label>
            <Input id="w-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" placeholder="+91 98xxxxxxxx" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-desig">Designation</Label>
            <Input id="w-desig" value={designation} onChange={(e) => setDesignation(e.target.value)} className="h-11" placeholder="e.g. Branch Manager" />
          </div>
          <div className="space-y-2">
            <Label>Signature</Label>
            {existingUrl.data && (
              <div className="rounded-xl border border-border p-2 bg-background">
                <p className="text-[11px] text-muted-foreground mb-1">Current signature (replace below)</p>
                <img src={existingUrl.data} alt={`Signature of ${witness?.full_name}`} className="h-16 object-contain" />
              </div>
            )}
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'draw' | 'upload')}>
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="draw">Draw</TabsTrigger>
                <TabsTrigger value="upload">Upload image</TabsTrigger>
              </TabsList>
              <TabsContent value="draw" className="mt-3">
                <div className="rounded-xl border border-border bg-background">
                  <SignaturePad ref={padRef} height={180} onChange={setPadEmpty} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{padEmpty ? 'Sign inside the box.' : 'Signature captured.'}</p>
              </TabsContent>
              <TabsContent value="upload" className="mt-3">
                <Input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Signature image" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <p className="text-[11px] text-muted-foreground mt-1">PNG on a white or transparent background works best. Max 2 MB.</p>
              </TabsContent>
            </Tabs>
          </div>
          {witness && (
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label htmlFor="w-active">Available for new contracts</Label>
              <Switch id="w-active" checked={active} onCheckedChange={setActive} />
            </div>
          )}
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2 bg-background pb-safe">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save witness
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
