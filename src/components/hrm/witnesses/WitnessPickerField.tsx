import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, PenLine } from 'lucide-react';
import { useContractWitnesses, useWitnessSignatureUrl, type ContractWitness } from './useContractWitnesses';
import { WitnessSheet } from './WitnessSheet';

interface Props {
  slot: 1 | 2;
  branchId: string | null;
  selectedId?: string;
  excludeId?: string;
  employeeName?: string;
  onPick: (w: ContractWitness | null) => void;
}

const MANUAL = '__manual__';

export function WitnessPickerField({ slot, branchId, selectedId, excludeId, employeeName, onPick }: Props) {
  const { data: witnesses = [], isLoading } = useContractWitnesses(branchId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const selected = witnesses.find((w) => w.id === selectedId) ?? null;
  const sig = useWitnessSignatureUrl(selected?.signature_path);
  const empName = (employeeName || '').trim().toLowerCase();
  const id = `witness-pick-${slot}`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs">Choose saved witness</Label>
      <div className="flex gap-2">
        <Select
          value={selectedId || MANUAL}
          onValueChange={(v) => onPick(v === MANUAL ? null : witnesses.find((w) => w.id === v) ?? null)}
        >
          <SelectTrigger id={id} className="h-11 flex-1">
            <SelectValue placeholder={isLoading ? 'Loading…' : 'Type details manually'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={MANUAL}>Type details manually</SelectItem>
            {witnesses.map((w) => {
              const disabled = w.id === excludeId || (!!empName && w.full_name.trim().toLowerCase() === empName);
              return (
                <SelectItem key={w.id} value={w.id} disabled={disabled}>
                  {w.full_name}{w.phone ? ` · ${w.phone}` : ''}{w.signature_path ? '' : ' (no signature)'}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" className="h-11 gap-1" onClick={() => setSheetOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />New
        </Button>
      </div>
      {selected && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-2">
          {sig.data
            ? <img src={sig.data} alt={`Signature of ${selected.full_name}`} className="h-10 max-w-[140px] object-contain" />
            : <span className="text-[11px] text-warning flex items-center gap-1"><PenLine className="h-3 w-3" aria-hidden />No signature saved yet</span>}
          <div className="text-xs">
            <p className="font-medium">{selected.full_name}</p>
            <p className="text-muted-foreground">{[selected.designation, selected.phone].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      )}
      <WitnessSheet open={sheetOpen} onOpenChange={setSheetOpen} branchId={branchId} onSaved={(w) => onPick(w)} />
    </div>
  );
}
