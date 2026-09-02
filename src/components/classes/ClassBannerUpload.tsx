import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Trash2, Sparkles } from 'lucide-react';

const BUCKET = 'template-media';
const PREFIX = 'class-banners';
const MAX_EDGE = 1600;
const MAX_BYTES = 5 * 1024 * 1024;

/** Resize + JPEG-compress a poster so banners stay light on member phones. */
async function prepareBanner(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.86),
  );
  return blob ?? file;
}

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  /** Optional label override. */
  label?: string;
}

export function ClassBannerUpload({ value, onChange, label = 'Class banner' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { effectiveBranchId } = useBranchContext();

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file (JPG or PNG)');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Banner must be under 5 MB');
      return;
    }
    if (!effectiveBranchId) {
      toast.error('Select a branch before uploading a banner');
      return;
    }
    setUploading(true);
    try {
      const blob = await prepareBanner(file);
      // Branch-scoped folder so RLS can enforce cross-branch write isolation.
      const path = `${PREFIX}/${effectiveBranchId}/${crypto.randomUUID()}.jpg`;

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success('Banner uploaded');
    } catch (e: any) {
      toast.error(e?.message || 'Could not upload the banner');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="class-banner-input">{label}</Label>
      <input
        id="class-banner-input"
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {value ? (
        <div className="relative overflow-hidden rounded-2xl border bg-muted">
          <img
            src={value}
            alt="Class banner preview"
            className="aspect-video w-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/60 to-transparent p-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="cursor-pointer"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Replace</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="cursor-pointer"
              aria-label="Remove banner"
              disabled={uploading}
              onClick={() => onChange(null)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-muted/30 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <>
              <ImagePlus className="h-6 w-6" />
              <span className="text-sm font-medium">Upload class poster</span>
              <span className="flex items-center gap-1 text-xs">
                <Sparkles className="h-3 w-3" /> Shown to members when booking · 16:9 · max 5 MB
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
