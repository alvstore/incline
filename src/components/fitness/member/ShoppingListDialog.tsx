import { useMemo, useState } from 'react';
import {
  ResponsiveSheet,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetFooter,
} from '@/components/ui/ResponsiveSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShoppingCart, Download, Share2, Copy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { buildShoppingList } from '@/services/memberPlanProgressService';
import type { DietPlanContent } from '@/types/fitnessPlan';
import { toast } from 'sonner';
import { WhatsAppShareDialog } from './WhatsAppShareDialog';

interface ShoppingListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diet: DietPlanContent | null;
  planName?: string;
  branchId?: string | null;
  memberId?: string | null;
  defaultPhone?: string | null;
}

export function ShoppingListDialog({
  open,
  onOpenChange,
  diet,
  planName,
  branchId,
  memberId,
  defaultPhone,
}: ShoppingListDialogProps) {
  const [days, setDays] = useState(7);
  const [shareOpen, setShareOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['shopping-list', planName, days, !!diet],
    enabled: open && !!diet,
    queryFn: () => buildShoppingList(diet!, days),
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grouped = data?.grouped ?? {};
  const allText = useMemo(() => {
    if (!data) return '';
    const lines: string[] = [`Shopping list — ${planName || 'My Diet Plan'} (next ${days} days)`];
    Object.entries(grouped).forEach(([cat, items]) => {
      lines.push('', cat);
      items.forEach((it) => lines.push(`  • ${it.name} ×${it.count}`));
    });
    return lines.join('\n');
  }, [data, grouped, days, planName]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(allText);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([allText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shopping-list-${days}d.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleShareWhatsApp = () => {
    if (!branchId) {
      toast.error('Cannot share — branch context missing');
      return;
    }
    setShareOpen(true);
  };

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange} width="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-accent" />
            Shopping List
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Aggregated ingredients from your meal plan, grouped by category.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <div className="flex items-end gap-2 mt-3">
          <div className="flex-1">
            <Label className="text-xs">Days to plan for</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(30, parseInt(e.target.value || '7', 10))))}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1 mt-3">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No ingredients found in your meal plan.
              </CardContent>
            </Card>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <Card key={category}>
                <CardContent className="p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {category}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((it) => (
                      <Badge key={it.name} variant="secondary" className="font-normal">
                        {it.name}{it.count > 1 ? ` ×${it.count}` : ''}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <ResponsiveSheetFooter>
          <Button variant="outline" size="sm" onClick={handleCopy} disabled={!data}>
            <Copy className="h-4 w-4 mr-1" /> Copy
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={!data}>
            <Download className="h-4 w-4 mr-1" /> Download
          </Button>
          <Button size="sm" onClick={handleShareWhatsApp} disabled={!data}>
            <Share2 className="h-4 w-4 mr-1" /> WhatsApp
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheet>

      <WhatsAppShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        branchId={branchId ?? null}
        memberId={memberId ?? null}
        defaultPhone={defaultPhone ?? null}
        message={allText}
        title="Share shopping list"
      />
    </>
  );
}
