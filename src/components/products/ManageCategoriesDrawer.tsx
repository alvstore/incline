import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Tags } from 'lucide-react';
import { AddCategoryDrawer } from '@/components/products/AddCategoryDrawer';
import type { Tables } from '@/integrations/supabase/types';

type CategoryRow = Pick<Tables<'product_categories'>, 'id' | 'name' | 'description' | 'image_url' | 'sort_order' | 'is_active'>;

interface ManageCategoriesDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManageCategoriesDrawer({ open, onOpenChange }: ManageCategoriesDrawerProps) {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['product-categories-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_categories')
        .select('id, name, description, image_url, sort_order, is_active')
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data as CategoryRow[];
    },
    enabled: open,
  });

  const { data: productCounts = {} } = useQuery({
    queryKey: ['product-counts-by-category'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('category_id')
        .eq('is_active', true);
      if (error) throw error;
      const counts: Record<string, number> = {};
      data.forEach((p) => {
        if (p.category_id) counts[p.category_id] = (counts[p.category_id] || 0) + 1;
      });
      return counts;
    },
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('product_categories')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Category removed');
      queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      queryClient.invalidateQueries({ queryKey: ['product-categories-all'] });
      setDeleteTarget(null);
    },
    onError: () => toast.error('Failed to remove category'),
  });

  const openAdd = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (c: CategoryRow) => { setEditing(c); setEditorOpen(true); };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-lg flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5" aria-hidden />Manage categories
            </SheetTitle>
            <SheetDescription>
              Categories group products in the catalog, stock list and at the counter.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
            ) : categories.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Tags className="h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">No categories yet. Add your first one below.</p>
              </div>
            ) : (
              categories.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:bg-secondary transition-colors duration-150"
                >
                  <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {c.image_url ? (
                      <img src={c.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Tags className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {productCounts[c.id] || 0} product{(productCounts[c.id] || 0) === 1 ? '' : 's'}
                      {!c.is_active && ' · inactive'}
                    </p>
                  </div>
                  {!c.is_active && (
                    <Badge variant="outline" className="bg-muted text-muted-foreground border-border">Inactive</Badge>
                  )}
                  <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => openEdit(c)}>
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  {c.is_active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${c.name}`}
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(c)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="pt-4 border-t border-border">
            <Button onClick={openAdd} className="w-full">
              <Plus className="h-4 w-4 mr-2" aria-hidden />Add category
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AddCategoryDrawer open={editorOpen} onOpenChange={setEditorOpen} category={editing} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} will be removed. Products in this category are kept but become uncategorised.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
