import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Download, Mail, MessageCircle, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { sendPlanToMember, type PlanSendChannel } from '@/utils/sendPlanToMember';

interface Props {
  member: { id: string; full_name: string; phone?: string | null; email?: string | null };
  plan: {
    name: string;
    type: 'workout' | 'diet';
    description?: string | null;
    data: any;
    valid_from?: string | null;
    valid_until?: string | null;
    trainer_name?: string | null;
  };
  branchId?: string | null;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'ghost' | 'default';
  triggerLabel?: string;
}

/** Reusable dropdown that lets staff Download / WhatsApp / Email a plan PDF. */
export function SendPlanPdfMenu({
  member,
  plan,
  branchId,
  size = 'sm',
  variant = 'outline',
  triggerLabel,
}: Props) {
  const [busy, setBusy] = useState<PlanSendChannel | null>(null);

  const run = async (channel: PlanSendChannel) => {
    setBusy(channel);
    try {
      const res = await sendPlanToMember({
        member,
        plan,
        branchId,
        channels: [channel],
      });
      const ch = res.channels[channel];
      if (ch?.sent) {
        if (channel === 'download') toast.success('PDF downloaded');
        else if (channel === 'whatsapp') {
          toast.success(
            ch.mode === 'link'
              ? 'WhatsApp sent as a download link (no approved document template)'
              : 'WhatsApp PDF sent as an attachment',
          );
        } else toast.success('Email sent');
      } else {
        toast.error(ch?.error || `${channel} send failed`);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send');
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant={variant} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {triggerLabel || 'Share'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Share plan PDF</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => run('download')} disabled={!!busy}>
          <Download className="h-4 w-4 mr-2" /> Download
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => run('whatsapp')}
          disabled={!!busy || !member.phone}
        >
          <MessageCircle className="h-4 w-4 mr-2" />
          WhatsApp
          {!member.phone && <span className="ml-auto text-[10px] text-muted-foreground">no phone</span>}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => run('email')}
          disabled={!!busy || !member.email}
        >
          <Mail className="h-4 w-4 mr-2" />
          Email
          {!member.email && <span className="ml-auto text-[10px] text-muted-foreground">no email</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
