import { useMemo, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

export interface ChatMessageBodyProps {
  content: string;
  direction: 'inbound' | 'outbound';
}

interface DocLink {
  url: string;
  label: string;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

/** True when a URL points to a document (short doc link or PDF in storage). */
export function isDocumentUrl(url: string): boolean {
  if (/\/functions\/v1\/doc\?c=/i.test(url)) return true;
  if (/\/storage\/v1\/object\//i.test(url) && /\.pdf/i.test(url)) return true;
  if (/\.pdf(\?|$)/i.test(url)) return true;
  // Signed storage links hide the path inside the JWT payload.
  const token = url.match(/[?&]token=([^&]+)/)?.[1];
  if (token && /\/storage\/v1\/object\/sign\//i.test(url)) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload?.url === 'string' && /\.pdf$/i.test(payload.url);
    } catch {
      return false;
    }
  }
  return false;
}

function labelFor(url: string, context: string): string {
  const lower = context.toLowerCase();
  if (lower.includes('posture')) return 'Posture scan report.pdf';
  if (lower.includes('body composition') || lower.includes('scan')) return 'Body composition report.pdf';
  if (lower.includes('invoice')) return 'Invoice.pdf';
  if (lower.includes('receipt')) return 'Receipt.pdf';
  if (lower.includes('diet')) return 'Diet plan.pdf';
  if (lower.includes('workout')) return 'Workout plan.pdf';
  return 'Document.pdf';
}

/** Renders chat text with PDF links pulled out into preview cards. */
export function ChatMessageBody({ content, direction }: ChatMessageBodyProps) {
  const [preview, setPreview] = useState<DocLink | null>(null);

  const { text, docs } = useMemo(() => {
    const found: DocLink[] = [];
    const seen = new Set<string>();
    let cleaned = content.replace(URL_RE, (raw) => {
      const url = raw.replace(/[.,;:!?]+$/, '');
      const trail = raw.slice(url.length);
      if (!isDocumentUrl(url)) return raw;
      const label = labelFor(url, content);
      if (found.some((f) => f.label === label)) return trail;
      if (!seen.has(url)) {
        seen.add(url);
        found.push({ url, label });
      }
      return trail;
    });
    cleaned = cleaned
      .replace(/\s*[—–-]?\s*PDF:\s*(?=[\s,.]|$)/gi, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.])/g, '$1')
      .trim();
    return { text: cleaned, docs: found };
  }, [content]);

  const isOut = direction === 'outbound';
  const parts = text.split(URL_RE);
  const links = text.match(URL_RE) ?? [];

  return (
    <>
      {docs.length > 0 && (
        <div className="mb-2 -mx-1 space-y-1.5">
          {docs.map((d) => (
            <button
              key={d.url}
              type="button"
              onClick={() => setPreview(d)}
              aria-label={`Preview ${d.label}`}
              className={`w-full min-h-11 flex items-center gap-3 rounded-lg px-3 py-2 text-left cursor-pointer transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring ${
                isOut ? 'bg-card/15 hover:bg-card/25 text-primary-foreground' : 'bg-muted/60 hover:bg-muted text-foreground'
              }`}
            >
              <span className={`h-10 w-10 rounded-md flex items-center justify-center shrink-0 ${isOut ? 'bg-card/20' : 'bg-destructive/10 text-destructive'}`}>
                <FileText className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold truncate">{d.label}</span>
                <span className={`block text-[10px] ${isOut ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                  PDF · Tap to preview
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {text && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words [word-break:break-word] [overflow-wrap:anywhere] w-full">
          {parts.map((p, i) => (
            <span key={i}>
              {p}
              {links[i] && (
                <a href={links[i]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {links[i]}
                </a>
              )}
            </span>
          ))}
        </p>
      )}
      <Sheet open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <SheetContent className="w-full sm:max-w-2xl flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-3 border-b">
            <SheetTitle className="truncate pr-8">{preview?.label}</SheetTitle>
            <SheetDescription>Document shared in this chat</SheetDescription>
          </SheetHeader>
          <div className="flex-1 p-4 min-h-0">
            {preview && (
              <iframe src={preview.url} title={preview.label} className="w-full h-full min-h-[60vh] rounded-xl border bg-background" />
            )}
          </div>
          <div className="px-6 py-4 border-t flex justify-end">
            <Button asChild className="gap-1.5 min-h-11">
              <a href={preview?.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" /> Open / Download
              </a>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
