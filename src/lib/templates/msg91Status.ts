// Client mirror of supabase/functions/_shared/msg91.ts#registerBlocker — the server stays authoritative.
export type Msg91Tone = 'success' | 'warning' | 'danger' | 'muted';

export function msg91StatusLabel(status: string | null | undefined): { label: string; tone: Msg91Tone } {
  switch (status) {
    case 'synced': return { label: 'MSG91 synced', tone: 'success' };
    case 'needs_resync': return { label: 'Needs resync', tone: 'warning' };
    case 'failed': return { label: 'Sync failed', tone: 'danger' };
    default: return { label: 'Not in MSG91', tone: 'muted' };
  }
}

export function msg91RegisterBlocker(t: { content?: string | null; dlt_template_id?: string | null; dlt_header?: string | null }): string | null {
  if (!t.content?.trim()) return 'Template body is empty';
  if (!t.dlt_template_id || !/^\d{19}$/.test(t.dlt_template_id)) return 'Approved 19-digit DLT Template ID from SmartPing is required';
  if (!t.dlt_header || !/^[A-Za-z0-9]{6}$/.test(t.dlt_header)) return 'Approved 6-character DLT header is required';
  return null;
}
