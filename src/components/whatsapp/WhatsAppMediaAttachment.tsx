import { useQuery } from '@tanstack/react-query';
import { FileText, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface MediaMeta {
  meta_id?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  bucket?: string | null;
  size?: number | null;
  error?: string | null;
  kind?: string | null;
}

interface Props {
  mediaUrl: string;
  mediaMeta?: MediaMeta | null;
  messageType: 'image' | 'document' | string;
  direction: 'inbound' | 'outbound';
}

// Resolves a signed URL when mediaUrl is a storage path inside the
// `whatsapp-media` bucket. If it's already an http(s) URL, passes through.
function useResolvedUrl(path: string, bucket: string | null | undefined) {
  const isHttp = /^https?:\/\//i.test(path);
  return useQuery({
    queryKey: ['wa-media-signed', bucket ?? 'wa', path],
    enabled: !isHttp && !!path && !!bucket,
    staleTime: 4 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(bucket as string)
        .createSignedUrl(path, 300);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function WhatsAppMediaAttachment({ mediaUrl, mediaMeta, messageType, direction }: Props) {
  const isHttp = /^https?:\/\//i.test(mediaUrl);
  const bucket = mediaMeta?.bucket ?? (isHttp ? null : 'whatsapp-media');
  const { data: signedUrl, isLoading, isError } = useResolvedUrl(mediaUrl, bucket);
  const url = isHttp ? mediaUrl : signedUrl;

  // Meta media expired or download failed at webhook time
  if (mediaMeta?.error) {
    return (
      <div className={`mb-2 -mx-1 flex items-center gap-3 rounded-lg px-3 py-2 ${
        direction === 'outbound' ? 'bg-card/15 text-primary-foreground' : 'bg-warning/10 text-warning'
      }`}>
        <AlertCircle className="h-5 w-5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold truncate">
            {mediaMeta.filename || 'Attachment'}
          </div>
          <div className={`text-[10px] ${direction === 'outbound' ? 'text-primary-foreground/70' : 'text-warning'}`}>
            Attachment unavailable (Meta link expired)
          </div>
        </div>
      </div>
    );
  }

  if (messageType === 'image') {
    if (!url) {
      return (
        <div className="mb-2 -mx-1 h-40 w-full max-w-[260px] rounded-lg bg-muted flex items-center justify-center">
          {isError ? <AlertCircle className="h-5 w-5 text-muted-foreground" /> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        </div>
      );
    }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mb-2 -mx-1">
        <img
          src={url}
          alt={mediaMeta?.filename || 'Photo'}
          className="rounded-lg max-h-64 w-auto object-cover border border-black/5"
          loading="lazy"
        />
      </a>
    );
  }

  // document / pdf / other
  const filename = mediaMeta?.filename
    || (isHttp ? decodeURIComponent(mediaUrl.split('/').pop() || 'document') : 'Document');
  const sizeLabel = mediaMeta?.size
    ? ` · ${(mediaMeta.size / 1024).toFixed(0)} KB`
    : '';
  const mimeLabel = (mediaMeta?.mime_type || '').includes('pdf') ? 'PDF' : (mediaMeta?.mime_type?.split('/').pop()?.toUpperCase() || 'File');

  const inner = (
    <>
      <div className={`h-10 w-10 rounded-md flex items-center justify-center flex-shrink-0 ${
        direction === 'outbound' ? 'bg-card/20' : 'bg-destructive/10 text-destructive'
      }`}>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold truncate">{filename}</div>
        <div className={`text-[10px] ${direction === 'outbound' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
          {url ? `Tap to open · ${mimeLabel}${sizeLabel}` : isError ? 'Unavailable' : 'Loading…'}
        </div>
      </div>
    </>
  );

  const wrapClass = `mb-2 -mx-1 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
    direction === 'outbound'
      ? 'bg-card/15 hover:bg-card/25 text-primary-foreground'
      : 'bg-muted/60 hover:bg-muted text-foreground'
  }`;

  if (!url) {
    return <div className={wrapClass}>{inner}</div>;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={wrapClass}>
      {inner}
    </a>
  );
}
