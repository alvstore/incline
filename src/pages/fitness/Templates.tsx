import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Library, Dumbbell, Apple, Search, ArrowLeft } from 'lucide-react';
import { FitnessHubTabs } from '@/components/fitness/FitnessHubTabs';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export default function Templates() {
  const [planType, setPlanType] = useState<"workout" | "diet">("workout");
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: templates, isLoading } = useQuery({
    queryKey: ['fitness-templates', planType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('templates' as any)
        .select('*')
        .eq('type', 'document')
        .eq('category', planType === 'workout' ? 'workout' : 'diet')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    }
  });

  const filtered = (templates ?? []).filter(t => 
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const handleDownload = (url: string) => {
    if (!url) {
      toast.error("No file available for this template");
      return;
    }
    window.open(url, '_blank');
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <FitnessHubTabs />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Library className="h-5 w-5 text-primary" />
              {`400 — https://iyqqpbvnszyrrgerniog.supabase.co/storage/v1/object/attachments/fitness-plans/f363e15d-6bb9-4aff-9e1e-7f279bbc1e5d/1787119020353-Workout-Plan-FAT_LOSS_PROGRAM.pdf`}
            </h2>
            <p className="text-sm text-muted-foreground">
              Browse, preview, and assign workout & diet templates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl bg-muted/50 p-1 gap-1">
              <Button
                size="sm"
                variant={planType === "workout" ? "default" : "ghost"}
                onClick={() => setPlanType("workout")}
                className="gap-1.5"
              >
                <Dumbbell className="h-4 w-4" /> Workout
              </Button>
              <Button
                size="sm"
                variant={planType === "diet" ? "default" : "ghost"}
                onClick={() => setPlanType("diet")}
                className="gap-1.5"
              >
                <Apple className="h-4 w-4" /> Diet
              </Button>
            </div>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder={`Search ${planType} templates...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl"
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed">
            <Library className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">No templates found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(t => (
              <Card key={t.id} className="rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden border-border/50 group" onClick={() => handleDownload(t.pdf_url)}>
                <CardContent className="p-5">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-lg line-clamp-1">{t.name}</h3>
                    <Badge variant="secondary" className="capitalize">{t.category}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4 h-10">
                    {t.description || "No description provided."}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border/50">
                    <span>Added {new Date(t.created_at).toLocaleDateString()}</span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs rounded-lg group-hover:bg-primary group-hover:text-primary-foreground">
                      View PDF
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
