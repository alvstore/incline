import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Trash2, Image, ExternalLink } from 'lucide-react';

interface AdBannerManagerProps {
  branchId: string;
}

export function AdBannerManager({ branchId }: AdBannerManagerProps) {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [uploading, setUploading] = useState(false);

  const { data: banners = [], isLoading } = useQuery({
    queryKey: ['ad-banners', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ad_banners')
        .select('*')
        .eq('branch_id', branchId)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!imageUrl) throw new Error('Image is required');
      const { error } = await supabase.from('ad_banners').insert({
        branch_id: branchId, title, image_url: imageUrl,
        redirect_url: redirectUrl || null, is_active: isActive,
        display_order: banners.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Banner added');
      queryClient.invalidateQueries({ queryKey: ['ad-banners'] });
      setDrawerOpen(false);
      resetForm();
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add banner'),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('ad_banners').update({ is_active: active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ad-banners'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ad_banners').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Banner deleted');
      queryClient.invalidateQueries({ queryKey: ['ad-banners'] });
    },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('ad-banners')
        .upload(path, file, { upsert: false, cacheControl: '3600' });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('ad-banners').getPublicUrl(path);
      setImageUrl(urlData.publicUrl);
    } catch (err: any) {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => { setTitle(''); setImageUrl(''); setRedirectUrl(''); setIsActive(true); };

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-primary/20">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
          <Image className="h-5 w-5 text-accent" /> Ad Banners
        </CardTitle>
        <Button size="sm" onClick={() => setDrawerOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Banner
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : banners.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Image className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>No banners yet. Add one to promote offers on the member dashboard.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Preview</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {banners.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <img src={b.image_url} alt={b.title || 'Banner'} className="h-12 w-20 rounded-lg object-cover" />
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{b.title || 'Untitled'}</p>
                    {b.redirect_url && (
                      <a href={b.redirect_url} target="_blank" rel="noreferrer" className="text-xs text-primary flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" /> Link
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch checked={b.is_active} onCheckedChange={(v) => toggleMutation.mutate({ id: b.id, active: v })} />
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                      onClick={() => { if (confirm('Delete this banner?')) deleteMutation.mutate(b.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader><SheetTitle>Add Banner</SheetTitle></SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Banner Image *</Label>
              <Input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
              {uploading && <p className="text-xs text-muted-foreground">Uploading...</p>}
              {imageUrl && <img src={imageUrl} alt="Preview" className="w-full h-32 rounded-xl object-cover mt-2" />}
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer Offer" />
            </div>
            <div className="space-y-2">
              <Label>Redirect URL</Label>
              <Input value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>Active</Label>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !imageUrl}>
              {createMutation.isPending ? 'Adding...' : 'Add Banner'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
