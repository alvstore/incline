import { FileText, ImageIcon, Download, Play } from 'lucide-react';

interface Props {
  url?: string | null;
  kind?: string | null;
  filename?: string | null;
  compact?: boolean;
}

export function AnnouncementAttachment({ url, kind, filename, compact }: Props) {
  if (!url) return null;

  if (kind === 'image') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block group">
        <img
          src={url}
          alt={filename || 'Attachment'}
          className={`rounded-xl border border-border/60 object-cover w-full ${compact ? 'max-h-48' : 'max-h-80'} group-hover:opacity-95 transition`}
          loading="lazy"
        />
      </a>
    );
  }

  if (kind === 'video') {
    return (
      <video
        src={url}
        controls
        playsInline
        className={`rounded-xl border border-border/60 w-full ${compact ? 'max-h-48' : 'max-h-80'} bg-foreground`}
      />
    );
  }

  // document / pdf
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm hover:bg-muted/50 transition"
    >
      <FileText className="h-4 w-4 text-warning" />
      <span className="truncate max-w-[200px]">{filename || 'Attachment'}</span>
      <Download className="h-3.5 w-3.5 text-muted-foreground" />
    </a>
  );
}
