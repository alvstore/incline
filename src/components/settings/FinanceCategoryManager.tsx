import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ResponsiveSheet,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetFooter,
} from '@/components/ui/ResponsiveSheet';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, ToggleLeft, ToggleRight, ArrowUpRight, ArrowDownRight } from 'lucide-react';

type CategoryType = 'income' | 'expense';

function CategoryTable({ type }: { type: CategoryType }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });

  const tableName = type === 'income' ? 'income_categories' : 'expense_categories';
  const queryKey = type === 'income' ? 'income-categories-all' : 'expense-categories-all';

  const { data: categories = [], isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: async () => {
      const { data, error } = await supabase.from(tableName).select('*').order('name');
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingCategory) {
        const { error } = await supabase
          .from(tableName)
          .update({ name: formData.name, description: formData.description })
          .eq('id', editingCategory.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(tableName)
          .insert({ name: formData.name, description: formData.description, is_active: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingCategory ? 'Category updated' : 'Category created');
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      setIsOpen(false);
      resetForm();
    },
    onError: (error: any) => toast.error(error.message || 'Failed to save category'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from(tableName).update({ is_active: !is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Category status updated');
      queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (error: any) => toast.error(error.message || 'Failed to update'),
  });

  const resetForm = () => {
    setFormData({ name: '', description: '' });
    setEditingCategory(null);
  };

  const handleEdit = (category: any) => {
    setEditingCategory(category);
    setFormData({ name: category.name, description: category.description || '' });
    setIsOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      toast.error('Name is required');
      return;
    }
    saveMutation.mutate();
  };

  const label = type === 'income' ? 'Income' : 'Expense';

  return (
    <>
      <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-foreground">{label} Categories</CardTitle>
              <CardDescription>Manage {label.toLowerCase()} categories for financial tracking</CardDescription>
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add Category
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No {label.toLowerCase()} categories found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category: any) => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell className="text-muted-foreground">{category.description || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={category.is_active ? 'default' : 'secondary'}>
                        {category.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(category)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            toggleActiveMutation.mutate({ id: category.id, is_active: category.is_active })
                          }
                          title={category.is_active ? 'Deactivate' : 'Activate'}
                        >
                          {category.is_active ? (
                            <ToggleRight className="h-4 w-4 text-primary" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ResponsiveSheet
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) resetForm();
        }}
        width="md"
      >
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>
            {editingCategory ? 'Edit Category' : `Add ${label} Category`}
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            {editingCategory
              ? `Update ${label.toLowerCase()} category details`
              : `Create a new ${label.toLowerCase()} category`}
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4 flex-1 flex flex-col">
          <div className="space-y-4 flex-1">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name *</Label>
              <Input
                id="cat-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={type === 'income' ? 'Membership Fees' : 'Utilities'}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-desc">Description</Label>
              <Input
                id="cat-desc"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={type === 'income' ? 'Revenue from memberships' : 'Electricity, Water, Internet'}
              />
            </div>
          </div>
          <ResponsiveSheetFooter>
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : editingCategory ? 'Update' : 'Create'}
            </Button>
          </ResponsiveSheetFooter>
        </form>
      </ResponsiveSheet>
    </>
  );
}

export function FinanceCategoryManager() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="income">
        <TabsList>
          <TabsTrigger value="income" className="gap-2">
            <ArrowUpRight className="h-4 w-4 text-success" />
            Income Categories
          </TabsTrigger>
          <TabsTrigger value="expense" className="gap-2">
            <ArrowDownRight className="h-4 w-4 text-destructive" />
            Expense Categories
          </TabsTrigger>
        </TabsList>
        <TabsContent value="income" className="mt-4">
          <CategoryTable type="income" />
        </TabsContent>
        <TabsContent value="expense" className="mt-4">
          <CategoryTable type="expense" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
