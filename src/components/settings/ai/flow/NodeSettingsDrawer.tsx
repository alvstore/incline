// Right-side drawer for editing one step of the assistant workflow.
import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import type { FlowNode, FlowNodeData } from '@/lib/agentFlow/types';

interface Props {
  node: FlowNode | null;
  readOnly?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (nodeId: string, data: FlowNodeData) => void;
  onDelete: (nodeId: string) => void;
}

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'messenger', label: 'Messenger' },
];

const CHECKS = [
  { id: 'opt_out', label: 'Stop if they asked not to be contacted' },
  { id: 'bot_paused', label: 'Stop if the chat is paused' },
  { id: 'blocked', label: 'Stop if the number is blocked' },
  { id: 'duplicate', label: 'Stop if the same message repeats' },
];

const AUDIENCE_OPTIONS = [
  { id: 'member', label: 'Member' },
  { id: 'lead', label: 'Enquiry' },
  { id: 'staff', label: 'Team member' },
];

const ROLES = ['owner', 'admin', 'manager', 'staff', 'trainer'];

function CheckList({
  options, value, onChange, disabled,
}: { options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label key={opt.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
          <Checkbox
            checked={value.includes(opt.id)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange(checked ? [...value, opt.id] : value.filter((v) => v !== opt.id))
            }
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

export function NodeSettingsDrawer({ node, readOnly, open, onOpenChange, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<FlowNodeData | null>(null);

  useEffect(() => {
    setDraft(node ? { ...node.data } : null);
  }, [node?.id, node?.data]);

  if (!node || !draft) return null;
  const set = (patch: Partial<FlowNodeData>) => setDraft({ ...draft, ...patch });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-slate-200 px-6 py-4">
          <SheetTitle className="text-slate-900">Edit step</SheetTitle>
          <SheetDescription>Change how this part of the conversation behaves.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            <Label htmlFor="node-label">Step name</Label>
            <Input id="node-label" value={draft.label} disabled={readOnly} onChange={(e) => set({ label: e.target.value })} />
          </div>

          {node.type === 'trigger' && (
            <div className="space-y-2">
              <Label>Channels this flow listens on</Label>
              <CheckList options={CHANNELS} value={draft.channels ?? []} disabled={readOnly} onChange={(channels) => set({ channels })} />
            </div>
          )}

          {node.type === 'safety' && (
            <div className="space-y-2">
              <Label>Checks before replying</Label>
              <CheckList options={CHECKS} value={draft.checks ?? []} disabled={readOnly} onChange={(checks) => set({ checks })} />
            </div>
          )}

          {node.type === 'identify' && (
            <div className="space-y-2">
              <Label>Paths this step can take</Label>
              <CheckList options={AUDIENCE_OPTIONS} value={draft.audiences ?? []} disabled={readOnly} onChange={(audiences) => set({ audiences })} />
            </div>
          )}

          {node.type === 'agent' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="agent-role">Who it talks to</Label>
                <Select value={draft.agentRole ?? ''} disabled={readOnly} onValueChange={(v) => set({ agentRole: v as FlowNodeData['agentRole'] })}>
                  <SelectTrigger id="agent-role"><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead">Enquiries (sales only)</SelectItem>
                    <SelectItem value="member">Members</SelectItem>
                    <SelectItem value="staff">Team members</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-persona">Assistant name</Label>
                <Input id="agent-persona" value={draft.persona ?? ''} disabled={readOnly} onChange={(e) => set({ persona: e.target.value })} />
              </div>
            </>
          )}

          {node.type === 'tool' && (
            <div className="space-y-2">
              <Label htmlFor="tool-list">Look-ups allowed</Label>
              <Textarea
                id="tool-list"
                rows={4}
                placeholder="Leave empty to allow everything this person is entitled to see."
                value={(draft.tools ?? []).join(', ')}
                disabled={readOnly}
                onChange={(e) => set({ tools: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              />
              <p className="text-xs text-slate-500">Separate names with commas. Role limits always apply on top of this.</p>
            </div>
          )}

          {node.type === 'condition' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="cond-field">What to check</Label>
                <Input id="cond-field" placeholder="e.g. membership status" value={draft.field ?? ''} disabled={readOnly} onChange={(e) => set({ field: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cond-op">Comparison</Label>
                <Select value={draft.operator ?? 'is'} disabled={readOnly} onValueChange={(v) => set({ operator: v as FlowNodeData['operator'] })}>
                  <SelectTrigger id="cond-op"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="is">is</SelectItem>
                    <SelectItem value="is_not">is not</SelectItem>
                    <SelectItem value="contains">contains</SelectItem>
                    <SelectItem value="greater_than">is more than</SelectItem>
                    <SelectItem value="less_than">is less than</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cond-value">Value</Label>
                <Input id="cond-value" value={draft.value ?? ''} disabled={readOnly} onChange={(e) => set({ value: e.target.value })} />
              </div>
            </>
          )}

          {node.type === 'handoff' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="pause">Pause the assistant for (minutes)</Label>
                <Input id="pause" type="number" min={5} value={draft.pauseMinutes ?? 30} disabled={readOnly} onChange={(e) => set({ pauseMinutes: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Alert these people</Label>
                <CheckList options={ROLES.map((r) => ({ id: r, label: r }))} value={draft.notifyRoles ?? []} disabled={readOnly} onChange={(notifyRoles) => set({ notifyRoles })} />
              </div>
            </>
          )}

          {node.type === 'send' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="send-channel">Reply on</Label>
                <Select value={draft.channel ?? 'auto'} disabled={readOnly} onValueChange={(v) => set({ channel: v as FlowNodeData['channel'] })}>
                  <SelectTrigger id="send-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">The same channel they used</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="in_app">In the app</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="send-template">Template to use (optional)</Label>
                <Input id="send-template" value={draft.templateKey ?? ''} disabled={readOnly} onChange={(e) => set({ templateKey: e.target.value })} />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="node-note">Note for your team</Label>
            <Textarea id="node-note" rows={3} value={draft.note ?? ''} disabled={readOnly} onChange={(e) => set({ note: e.target.value })} />
          </div>

          {!readOnly && node.type !== 'trigger' && (
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 rounded-xl text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => { onDelete(node.id); onOpenChange(false); }}
            >
              <Trash2 className="h-4 w-4" /> Remove this step
            </Button>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="rounded-xl"
            disabled={readOnly}
            onClick={() => { onSave(node.id, draft); onOpenChange(false); }}
          >
            Save step
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
