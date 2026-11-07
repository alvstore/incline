import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, PenLine, UserCheck } from 'lucide-react';
import { useContractWitnesses, type ContractWitness } from './useContractWitnesses';
import { WitnessSheet } from './WitnessSheet';

export function WitnessManagerCard({ branchId }: { branchId: string | null }) {
  const { data = [], isLoading, isError, refetch } = useContractWitnesses(branchId, true);
  const [editing, setEditing] = useState<ContractWitness | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <Card className="rounded-xl border border-border">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Contract witnesses</CardTitle>
          <CardDescription>Saved witnesses with signatures, picked when creating a contract.</CardDescription>
        </div>
        <Button size="sm" className="gap-1" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4" aria-hidden />Add witness
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : isError ? (
          <div className="text-sm text-muted-foreground">Witnesses could not be loaded. <Button variant="link" onClick={() => refetch()}>Try again</Button></div>
        ) : data.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-40" aria-hidden />No saved witnesses yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => { setEditing(w); setOpen(true); }}
                  className="w-full flex items-center gap-3 py-3 px-2 text-left rounded-lg hover:bg-secondary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Edit witness ${w.full_name}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{w.full_name}</p>
                    <p className="text-xs text-muted-foreground">{[w.designation, w.phone].filter(Boolean).join(' · ') || 'No mobile'}</p>
                  </div>
                  {w.signature_path
                    ? <Badge variant="outline" className="bg-success/10 text-success border-success/20">Signature saved</Badge>
                    : <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 gap-1"><PenLine className="h-3 w-3" aria-hidden />Add signature</Badge>}
                  {!w.is_active && <Badge variant="outline">Inactive</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <WitnessSheet open={open} onOpenChange={setOpen} branchId={editing?.branch_id ?? branchId} witness={editing} />
    </Card>
  );
}
