import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ResponsiveSheet,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetFooter,
} from '@/components/ui/ResponsiveSheet';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  parseMealCsv, mealTemplateCsv, downloadCsvFile, MEAL_CSV_COLUMNS, type ParsedMealRow,
} from '@/lib/nutrition/mealCatalogCsv';
import { bulkUpsertMealCatalog, type MealCatalogEntry } from '@/services/mealCatalogService';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingMeals: MealCatalogEntry[];
  branchId?: string | null;
};

export function MealCatalogImportSheet({ open, onOpenChange, existingMeals, branchId = null }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedMealRow[]>([]);

  const existingNames = useMemo(
    () => new Set(existingMeals.map(m => m.name.toLowerCase())),
    [existingMeals],
  );

  const counts = useMemo(() => ({
    created: rows.filter(r => r.status === 'new').length,
    updated: rows.filter(r => r.status === 'update').length,
    errors: rows.filter(r => r.status === 'error').length,
  }), [rows]);

  const reset = () => { setRows([]); setFileName(null); if (inputRef.current) inputRef.current.value = ''; };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseMealCsv(text, existingNames);
      if (!parsed.length) {
        toast.error('No data rows found in that CSV');
        return;
      }
      setFileName(file.name);
      setRows(parsed);
    } catch {
      toast.error('Could not read that file');
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const valid = rows.filter(r => r.status !== 'error').map(r => r.values as any);
      return bulkUpsertMealCatalog(valid, branchId);
    },
    onSuccess: ({ created, updated }) => {
      toast.success(`Imported — ${created} added, ${updated} updated`);
      queryClient.invalidateQueries({ queryKey: ['meal-catalog-admin'] });
      queryClient.invalidateQueries({ queryKey: ['meal-catalog'] });
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }} width="xl">
      <ResponsiveSheetHeader>
        <ResponsiveSheetTitle>Import Meals from CSV</ResponsiveSheetTitle>
      </ResponsiveSheetHeader>

      <div className="mt-4 flex-1 space-y-4 overflow-auto">
        <div className="rounded-2xl bg-muted/40 p-4">
          <p className="text-sm font-medium">Expected columns</p>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {MEAL_CSV_COLUMNS.join(', ')}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Meals are matched by name — an existing meal is updated, a new name is added. Tags are separated by semicolons.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => downloadCsvFile('meal_catalog_template.csv', mealTemplateCsv())}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Download template
          </Button>
        </div>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label="Choose a CSV file to import"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {fileName ? 'Choose a different file' : 'Choose CSV file'}
          </Button>
          {fileName && <span className="ml-3 text-sm text-muted-foreground">{fileName}</span>}
        </div>

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {counts.created} new
              </Badge>
              <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                <RefreshCw className="mr-1 h-3 w-3" /> {counts.updated} updates
              </Badge>
              {counts.errors > 0 && (
                <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                  <AlertTriangle className="mr-1 h-3 w-3" /> {counts.errors} skipped
                </Badge>
              )}
            </div>

            <div className="max-h-[420px] overflow-auto rounded-2xl border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-12">Row</TableHead>
                    <TableHead>Meal</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">kcal</TableHead>
                    <TableHead className="text-right">P / C / F</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.rowNumber} className={r.status === 'error' ? 'bg-destructive/5' : undefined}>
                      <TableCell className="text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                      <TableCell className="font-medium">
                        {r.values.name || <span className="text-muted-foreground">(blank)</span>}
                        {r.errors.length > 0 && (
                          <p className="mt-0.5 text-[11px] text-destructive">{r.errors.join(' · ')}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs capitalize">{String(r.values.meal_type || '').replace('_', ' ')}</TableCell>
                      <TableCell className="text-right">{r.values.calories}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {r.values.protein} / {r.values.carbs} / {r.values.fats}
                      </TableCell>
                      <TableCell>
                        {r.status === 'new' && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">New</Badge>}
                        {r.status === 'update' && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Update</Badge>}
                        {r.status === 'error' && <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Skipped</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <ResponsiveSheetFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending || counts.created + counts.updated === 0}
        >
          {importMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Import {counts.created + counts.updated} rows
        </Button>
      </ResponsiveSheetFooter>
    </ResponsiveSheet>
  );
}
