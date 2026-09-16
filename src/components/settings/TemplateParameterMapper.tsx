import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, Sparkles, Variable } from 'lucide-react';
import {
  PAYLOAD_VARIABLES,
  VARIABLE_GROUPS,
  buildOrderedVariables,
  getPayloadVariable,
  namedPlaceholders,
  positionalSlots,
} from '@/lib/templates/payloadVariables';

interface Props {
  content: string;
  eventName?: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * Maps each WhatsApp positional placeholder ({{1}}, {{2}}, …) to a real data
 * field. The saved order becomes `templates.variables`, which the dispatcher
 * uses to fill Meta body parameters. An unmapped slot is the exact cause of
 * Meta error 132018 (template_param_empty), so it is surfaced loudly here.
 */
export function TemplateParameterMapper({ content, eventName, value, onChange }: Props) {
  const slots = useMemo(() => positionalSlots(content), [content]);
  const named = useMemo(() => namedPlaceholders(content), [content]);

  const maxSlot = slots.length ? slots[slots.length - 1] : 0;
  const mapped = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < maxSlot; i++) out.push(value[i] || '');
    return out;
  }, [value, maxSlot]);

  const unmapped = mapped.filter((k) => !k).length;

  const autoMap = () => onChange(buildOrderedVariables(content, eventName, []));

  const setSlot = (index: number, key: string) => {
    const next = [...mapped];
    next[index] = key;
    onChange(next);
  };

  const preview = useMemo(() => {
    return String(content || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
      const key = mapped[Number(n) - 1];
      const info = key ? getPayloadVariable(key) : undefined;
      return info?.sample ?? (key || '⚠︎');
    });
  }, [content, mapped]);

  if (maxSlot === 0) {
    if (named.length === 0) return null;
    return (
      <div className="rounded-2xl border bg-muted/20 p-3 space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Variable className="h-3.5 w-3.5" /> Data fields used
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {named.map((k) => {
            const known = !!getPayloadVariable(k);
            return (
              <Badge
                key={k}
                variant="outline"
                className={`text-[11px] rounded-full ${known ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
              >
                {`{{${k}}}`}
              </Badge>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Named fields are filled automatically at send time. Amber fields are not in the standard catalog.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-sm font-semibold flex items-center gap-1.5">
            <Variable className="h-4 w-4 text-primary" /> Parameter mapping
          </Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Tell us what goes into each numbered slot of the approved message.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unmapped === 0 ? (
            <Badge className="rounded-full bg-emerald-100 text-emerald-700 text-[11px] hover:bg-emerald-100">
              <CheckCircle2 className="h-3 w-3 mr-1" /> All mapped
            </Badge>
          ) : (
            <Badge className="rounded-full bg-amber-100 text-amber-700 text-[11px] hover:bg-amber-100">
              <AlertTriangle className="h-3 w-3 mr-1" /> {unmapped} unmapped
            </Badge>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-xl cursor-pointer"
            onClick={autoMap}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Auto-map
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {mapped.map((key, index) => {
          const info = key ? getPayloadVariable(key) : undefined;
          return (
            <div
              key={index}
              className="flex items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2 transition-colors duration-200 hover:bg-muted/40"
            >
              <span className="font-mono text-xs font-semibold text-primary w-10 shrink-0">
                {`{{${index + 1}}}`}
              </span>
              <div className="flex-1 min-w-0">
                <Select value={key || undefined} onValueChange={(v) => setSlot(index, v)}>
                  <SelectTrigger
                    aria-label={`Data field for placeholder ${index + 1}`}
                    className={`h-9 rounded-lg ${key ? '' : 'border-amber-300 text-amber-700'}`}
                  >
                    <SelectValue placeholder="Choose a data field…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {VARIABLE_GROUPS.map((group) => (
                      <SelectGroup key={group}>
                        <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {group}
                        </SelectLabel>
                        {PAYLOAD_VARIABLES.filter((v) => v.group === group).map((v) => (
                          <SelectItem key={v.key} value={v.key} className="cursor-pointer">
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="hidden sm:block text-[11px] text-muted-foreground truncate max-w-[9rem]">
                {info?.sample || '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl bg-muted/40 p-3">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
          Preview with sample data
        </p>
        <p className="text-sm whitespace-pre-wrap text-foreground/90">{preview}</p>
      </div>

      {unmapped > 0 && (
        <p className="text-[11px] text-amber-700 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
          Unmapped slots are blocked before sending (WhatsApp error 132018) so members never receive a
          half-written message.
        </p>
      )}
    </div>
  );
}

export default TemplateParameterMapper;
