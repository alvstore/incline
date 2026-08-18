import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileText, Sparkles, MessageSquare, Mail, Phone } from 'lucide-react';
import { DYNAMIC_PDF_PRESETS, type TemplatePreset } from '@/lib/templates/dynamicAttachment';

const CHANNEL_META: Record<string, { label: string; icon: typeof Mail }> = {
  whatsapp: { label: 'WhatsApp', icon: MessageSquare },
  email: { label: 'Email', icon: Mail },
  sms: { label: 'SMS', icon: Phone },
};

interface QuickPresetsMenuProps {
  /** Called with the chosen preset — it only pre-fills the template editor. */
  onSelect: (preset: TemplatePreset) => void;
  /** When set, only presets for this channel are offered. */
  filterType?: 'whatsapp' | 'sms' | 'email';
  variant?: 'header' | 'compact';
}

/**
 * Quick Presets is a shortcut menu: picking an item opens the manual template
 * editor pre-filled with a ready-made body, header type and dynamic PDF
 * filename. It never creates or submits a template on its own.
 */
export function QuickPresetsMenu({ onSelect, filterType, variant = 'compact' }: QuickPresetsMenuProps) {
  const presets = filterType
    ? DYNAMIC_PDF_PRESETS.filter((p) => p.type === filterType)
    : DYNAMIC_PDF_PRESETS;

  const grouped = presets.reduce<Record<string, TemplatePreset[]>>((acc, p) => {
    (acc[p.type] ||= []).push(p);
    return acc;
  }, {});

  const channels = Object.keys(grouped);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === 'header' ? 'secondary' : 'outline'}
          size={variant === 'header' ? 'default' : 'sm'}
          className={
            variant === 'header'
              ? 'bg-card/15 hover:bg-card/25 text-primary-foreground border-0 backdrop-blur-sm cursor-pointer'
              : 'rounded-xl cursor-pointer'
          }
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Quick Presets
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="pb-0">Start from a preset</DropdownMenuLabel>
        <p className="px-2 pb-2 pt-1 text-[11px] leading-relaxed text-muted-foreground">
          Pre-fills the template editor with a ready-made body and a dynamic PDF
          attachment. Nothing is saved until you submit the editor.
        </p>
        <DropdownMenuSeparator />

        {channels.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            No presets available for this channel yet.
          </div>
        )}

        {channels.map((channel, idx) => {
          const meta = CHANNEL_META[channel] ?? { label: channel, icon: FileText };
          const ChannelIcon = meta.icon;
          return (
            <div key={channel}>
              {idx > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ChannelIcon className="h-3 w-3" />
                {meta.label}
              </DropdownMenuLabel>
              {grouped[channel].map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => onSelect(p)}
                  className="flex items-start gap-2 py-2 cursor-pointer"
                >
                  <FileText className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Event: {p.trigger} · {p.attachment_filename_template}
                    </p>
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
